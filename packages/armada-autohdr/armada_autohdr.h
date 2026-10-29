#pragma once

#include <armada-autohdr.h>
#include <span>

#include "rendervulkan.hpp"
#include "convar.h"

#if HAVE_DRM
extern "C" {
#include <libliftoff.h>
}
#endif

namespace gamescope
{
	struct AutoHdrTransform
	{
		armada_autohdr_transform params;

		AutoHdrTransform( const glm::mat3 &nativeFromOutput, float sdrNits, float targetNits )
			: params{ {}, sdrNits, targetNits }
		{
			for ( int column = 0; column < 3; column++ )
				for ( int row = 0; row < 3; row++ )
					params.native_from_output[column * 3 + row] = nativeFromOutput[column][row];
		}

		static AutoHdrTransform Create( const displaycolorimetry_t &display,
			const displaycolorimetry_t &output, float sdrNits, float targetNits )
		{
			return {
				display == output ? glm::mat3( 1.0f ) :
					glm::inverse( normalised_primary_matrix( display.primaries, display.white, 1.0f ) ) *
						normalised_primary_matrix( output.primaries, output.white, 1.0f ),
				sdrNits, targetNits,
			};
		}

		// Keep this transform alive until the synchronous LUT build finishes.
		void Configure( tonemapping_t &tonemapping ) const
		{
			tonemapping.g22_luminance = params.target_nits;
			tonemapping.preGainTransform = Apply;
			tonemapping.preGainTransformData = this;
		}

		static glm::vec3 Apply( glm::vec3 color, const void *data )
		{
			const auto &transform = static_cast<const AutoHdrTransform *>( data )->params;
			const auto mapped = armada_autohdr_apply_transform( &transform, { color.r, color.g, color.b } );
			return { mapped.r, mapped.g, mapped.b };
		}
	};

	inline bool AutoHdrPlaneUsesLuts( const FrameInfo_t::Layer_t &layer, bool hardwareLuts )
	{
		return layer.autoHdr && hardwareLuts && layer.applyColorMgmt &&
			( layer.colorspace == GAMESCOPE_APP_TEXTURE_COLORSPACE_SRGB ||
			  layer.colorspace == GAMESCOPE_APP_TEXTURE_COLORSPACE_LINEAR );
	}

	inline uint32_t AutoHdrPlaneMask( const FrameInfo_t &frame, bool hardwareLuts )
	{
		uint32_t mask = 0;
		for ( int i = 0; i < frame.layers.count(); i++ )
			if ( AutoHdrPlaneUsesLuts( frame.layers.get( i ), hardwareLuts ) )
				mask |= 1u << i;
		return mask;
	}

	inline void BindAutoHdrCompositeLuts( const FrameInfo_t &frame, CVulkanCmdBuffer &cmdBuffer )
	{
		// Partial composition can omit the game while retaining its LUT pointers.
		const bool enabled = frame.layers.count() && frame.layers.get( 0 ).autoHdr;
		cmdBuffer.bindColorMgmtLuts( EOTF_Count,
			enabled ? frame.shaperLut[EOTF_Count] : nullptr,
			enabled ? frame.lut3D[EOTF_Count] : nullptr );
	}

	inline void ClearAutoHdrFrameLuts( FrameInfo_t &frame )
	{
		// Source-space captures keep the game's original SDR presentation.
		frame.shaperLut[EOTF_Count] = nullptr;
		frame.lut3D[EOTF_Count] = nullptr;
	}

	inline ConVar<bool> cv_armada_auto_hdr{ "armada_auto_hdr", false, "Enable inverse tone mapping for SDR games." };

	class AutoHdrPresentation
	{
	public:
		using Capabilities = armada_autohdr_capabilities;
		using Content = armada_autohdr_content;

		struct FrameState
		{
			bool active;
			bool primary;
			bool async;
		};

		bool Enabled() const { return cv_armada_auto_hdr; }

		bool Available( const Capabilities &caps ) const
		{
			return armada_autohdr_available( cv_armada_auto_hdr, &caps );
		}

		bool Active( bool available, const Content &content ) const
		{
			return armada_autohdr_active( available, &content );
		}

		void ReconcileColorState( gamescope_color_mgmt_t &pending, bool enabled )
		{
			if ( !enabled && !m_state.requested && !m_state.luts_enabled )
				return;
			if ( armada_autohdr_reconcile( &m_state, enabled ) )
				pending.externalDirtyCtr++;
		}

		template<typename BuildLuts>
		void UpdateLuts( gamescope_color_mgmt_luts &luts,
			const gamescope_color_mgmt_t &color, float sdrNits, BuildLuts build )
		{
			if ( !m_state.requested && !m_state.luts_enabled )
				return;
			luts.reset();
			if ( m_state.requested )
			{
				const auto transform = AutoHdrTransform::Create( color.displayColorimetry,
					color.outputEncodingColorimetry, sdrNits, color.flInternalDisplayBrightness );
				build( luts, transform );
			}
			// The normal color-management serial covers the completed update.
			armada_autohdr_luts_updated( &m_state );
		}

		bool PreparePlane( FrameInfo_t &frame, bool active,
			const gamescope_color_mgmt_luts &luts ) const
		{
			const bool hasLayers = frame.layers.count() != 0;
			if ( !armada_autohdr_prepare( active, frame.bFadingOut, hasLayers, luts.HasLuts(),
				hasLayers && ColorspaceIsHDR( frame.layers.get( 0 ).colorspace ) ) )
				return false;

			frame.layers.get( 0 ).autoHdr = true;
			frame.shaperLut[EOTF_Count] = luts.vk_lut1d;
			frame.lut3D[EOTF_Count] = luts.vk_lut3d;
			return true;
		}

		void Presented( bool primary, bool success, bool converted )
		{
			armada_autohdr_presented( &m_state, primary, success, converted );
		}

		int PresentFrame( IBackendConnector *connector, FrameInfo_t &frame,
			const gamescope_color_mgmt_luts &luts, const FrameState &state )
		{
			if ( !Enabled() )
			{
				if ( state.primary && m_state.presented )
					Presented( true, false, false );
				return connector ? connector->Present( &frame, state.async ) : 0;
			}
			const bool converted = PreparePlane( frame, state.active, luts );
			const int ret = connector ? connector->Present( &frame, state.async ) : 0;
			Presented( state.primary, connector && ret == 0, converted );
			return ret;
		}

		template<typename Available, typename ContentActive>
		void ExtendHdrOutput( bool &capable, bool &active,
			Available available, ContentActive content ) const
		{
			if ( !Enabled() )
				return;
			const bool convertedContent = content();
			capable = capable || available();
			active |= convertedContent;
		}

		bool HdrPresented() const { return Enabled() && armada_autohdr_hdr_presented( &m_state ); }

	private:
		armada_autohdr_state m_state{};
	};

	inline AutoHdrPresentation g_AutoHdr;

#if HAVE_DRM
	class AutoHdrScanout
	{
	public:
		template<typename Pipelines>
		int Apply( const Pipelines &pipelines, uint32_t gameLayerMask,
			std::span<liftoff_layer *const> layers, liftoff_output *output,
			drmModeAtomicReq *request, uint32_t flags, const liftoff_output_apply_options &options )
		{
			if ( !gameLayerMask && !m_constraintsSet )
				return liftoff_output_apply( output, request, flags, &options );
			m_constraintsSet = gameLayerMask != 0;
			struct Context
			{
				const Pipelines &pipelines;
				std::span<liftoff_layer *const> layers;
				liftoff_output *output;
				drmModeAtomicReq *request;
				uint32_t flags;
				const liftoff_output_apply_options &options;
			} context{ pipelines, layers, output, request, flags, options };

			// Keep Gamescope's vendored libliftoff behind synchronous callbacks.
			const armada_autohdr_scanout_ops ops{
				.data = &context, .pipeline_count = pipelines.size(), .layer_count = layers.size(),
				.pipeline = []( void *data, size_t index ) -> uint64_t {
					return static_cast<Context *>( data )->pipelines[index];
				},
				.unset_pipeline = []( void *data, size_t layer ) {
					liftoff_layer_unset_property( static_cast<Context *>( data )->layers[layer], "COLOR_PIPELINE" );
				},
				.set_pipeline = []( void *data, size_t layer, uint64_t pipeline ) {
					liftoff_layer_set_property( static_cast<Context *>( data )->layers[layer], "COLOR_PIPELINE", pipeline );
				},
				.apply = []( void *data ) {
					const auto &ctx = *static_cast<Context *>( data );
					return liftoff_output_apply( ctx.output, ctx.request, ctx.flags, &ctx.options );
				},
				.needs_composition = []( void *data ) -> uint32_t {
					return liftoff_output_needs_composition( static_cast<Context *>( data )->output );
				},
			};
			return armada_autohdr_scanout_apply( &m_state, gameLayerMask, &ops );
		}

	private:
		armada_autohdr_scanout_state m_state{};
		bool m_constraintsSet = false;
	};
#endif
}
