#include <array>
#include <bit>
#include <cstdint>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

// Test the production samplers without exporting them from Gamescope.
#include "color_helpers.cpp"
#include <armada-autohdr.h>

static armada_autohdr_transform test_transform( const glm::mat3 &matrix, float sdrNits, float targetNits )
{
	armada_autohdr_transform transform{ {}, sdrNits, targetNits };
	for ( int column = 0; column < 3; column++ )
		for ( int row = 0; row < 3; row++ )
			transform.native_from_output[column * 3 + row] = matrix[column][row];
	return transform;
}

static glm::vec3 apply_transform( glm::vec3 color, const armada_autohdr_transform &transform )
{
	const auto mapped = armada_autohdr_apply_transform( &transform, { color.r, color.g, color.b } );
	return { mapped.r, mapped.g, mapped.b };
}

static constexpr displaycolorimetry_t kNativeP3{
	.primaries = { { 0.68f, 0.32f }, { 0.265f, 0.69f }, { 0.15f, 0.06f } },
	.white = displaycolorimetry_709.white,
};

static void require_finite( float value )
{
	// Check the bits because fast-math can remove std::isfinite checks.
	REQUIRE( ( std::bit_cast<uint32_t>( value ) & 0x7f800000u ) != 0x7f800000u );
}

struct AutoHdrTestLuts
{
	lut1d_t shaper;
	lut3d_t color;
	displaycolorimetry_t output;
	glm::mat3 nativeFromOutput;
	EOTF eotf;
	float peak;
	float peakLimit;

	glm::vec3 decode( glm::vec3 encoded ) const
	{
		return eotf == EOTF_PQ ? pq_to_nits( encoded )
			: glm::pow( encoded, glm::vec3( 2.2f ) ) * peak;
	}

	glm::vec3 sample( glm::vec3 input ) const
	{
		return decode( ApplyLut3D_Tetrahedral( color, ApplyLut1D_Linear( shaper, input ) ) );
	}
};

static float plane_lut_value( uint64_t value, uint32_t bits )
{
	const uint64_t maximum = ( 1ull << bits ) - 1;
	value = ( value * maximum + 0x7fffffffull ) / 0xffffffffull;
	return float( value ) / float( maximum );
}

static void use_plane_precision( AutoHdrTestLuts &luts )
{
	// Model the MSM LUT precision, not the physical panel's bit depth.
	constexpr uint32_t entries = 257;
	constexpr uint32_t last = entries - 1;
	const auto encode = []( float value )
	{
		return uint64_t( quantize_lut_value_16bit( value ) ) * 0x10001u;
	};
	const auto source = luts.shaper;
	luts.shaper.resize( entries );
	const std::array inputs{ &source.dataR, &source.dataG, &source.dataB };
	const std::array outputs{ &luts.shaper.dataR, &luts.shaper.dataG, &luts.shaper.dataB };
	for ( size_t channel = 0; channel < inputs.size(); ++channel )
		for ( uint32_t i = 0; i < entries; ++i )
		{
			const uint32_t pos = i * ( source.lutSize - 1 );
			const uint32_t index = pos / last;
			const uint32_t fraction = pos % last;
			const uint32_t next = std::min( index + 1, uint32_t( source.lutSize - 1 ) );
			const uint64_t a = encode( ( *inputs[channel] )[index] );
			const uint64_t b = encode( ( *inputs[channel] )[next] );
			const uint64_t interpolated = ( a * ( last - fraction ) + b * fraction + last / 2 ) / last;
			( *outputs[channel] )[i] = plane_lut_value( interpolated, 12 );
		}
	luts.shaper.finalize();
	for ( auto &color : luts.color.data )
		for ( int channel = 0; channel < 3; ++channel )
			color[channel] = plane_lut_value( encode( color[channel] ), 10 );
}

static AutoHdrTestLuts build_luts( const displaycolorimetry_t &display, EOTF eotf,
	float peak, float gain = 1.0f, bool autoHdr = true, bool planePrecision = false )
{
	AutoHdrTestLuts luts{ .output = eotf == EOTF_PQ ? displaycolorimetry_2020 : display,
		.eotf = eotf, .peak = peak, .peakLimit = peak };
	displaycolorimetry_t input{};
	colormapping_t mapping{};
	buildSDRColorimetry( &input, &mapping, -1.0f, display );
	luts.nativeFromOutput = display == luts.output ? glm::mat3( 1.0f ) :
		glm::inverse( normalised_primary_matrix( display.primaries, display.white, 1.0f ) ) *
			normalised_primary_matrix( luts.output.primaries, luts.output.white, 1.0f );
	const auto transform = test_transform( luts.nativeFromOutput, 100.0f, peak );
	tonemapping_t tonemapping{};
	tonemapping.g22_luminance = peak;
	if ( autoHdr )
	{
		tonemapping.preGainTransform = []( glm::vec3 color, const void *data ) {
			return apply_transform( color, *static_cast<const armada_autohdr_transform *>( data ) );
		};
		tonemapping.preGainTransformData = &transform;
	}
	calcColorTransform<rendervulkan::s_nLutEdgeSize3d>( &luts.shaper, rendervulkan::s_nLutSize1d,
		&luts.color, input, EOTF_Gamma22, luts.output, eotf, display, {},
		k_EChromaticAdapatationMethod_Bradford, mapping, {}, tonemapping, nullptr, gain );
	for ( auto *channel : { &luts.shaper.dataR, &luts.shaper.dataG, &luts.shaper.dataB } )
		for ( float &value : *channel )
		{
			require_finite( value );
			value = quantize_lut_value_16bit( value ) / 65535.0f;
		}
	for ( glm::vec3 &color : luts.color.data )
		for ( int channel = 0; channel < 3; ++channel )
		{
			require_finite( color[channel] );
			REQUIRE( color[channel] >= 0.0f );
			REQUIRE( color[channel] <= 1.0f );
			color[channel] = quantize_lut_value_16bit( color[channel] ) / 65535.0f;
		}
	if ( planePrecision )
	{
		use_plane_precision( luts );
		if ( eotf == EOTF_PQ )
		{
			const glm::mat3 outputFromNative = glm::inverse( luts.nativeFromOutput );
			const glm::vec3 positive = glm::max( outputFromNative[0], glm::vec3( 0.0f ) ) +
				glm::max( outputFromNative[1], glm::vec3( 0.0f ) ) + glm::max( outputFromNative[2], glm::vec3( 0.0f ) );
			const float maximum = peak * std::max( { positive.r, positive.g, positive.b } );
			const float rounding = 0.5f / 65535.0f + 0.5f / 1023.0f;
			const float error = pq_to_nits( clamp01( nits_to_pq( maximum ) + rounding ) ) - maximum;
			const glm::vec3 nativeError = ( glm::abs( luts.nativeFromOutput[0] ) +
				glm::abs( luts.nativeFromOutput[1] ) + glm::abs( luts.nativeFromOutput[2] ) ) * error;
			luts.peakLimit = peak + std::max( { nativeError.r, nativeError.g, nativeError.b } );
		}
	}
	return luts;
}

TEST_CASE( "Auto HDR LUTs stay finite and respect the output peak", "[auto_hdr]" )
{
	for ( const auto &display : { displaycolorimetry_709, kNativeP3 } )
		for ( const EOTF eotf : { EOTF_Gamma22, EOTF_PQ } )
			for ( const float peak : { 100.0f, 500.0f, 1000.0f } )
				for ( const bool planePrecision : { false, true } )
				{
					CAPTURE( eotf, peak, planePrecision );
					const auto luts = build_luts( display, eotf, peak, 1.0f, true, planePrecision );
					for ( const glm::vec3 &encoded : luts.color.data )
					{
						const glm::vec3 native = luts.nativeFromOutput * luts.decode( encoded );
						for ( const float value : { native.r, native.g, native.b } )
						{
							require_finite( value );
							REQUIRE( value <= luts.peakLimit * 1.001f );
						}
					}
					REQUIRE( luts.sample( glm::vec3( 0.0f ) ) == glm::vec3( 0.0f ) );
				}
}

TEST_CASE( "Auto HDR preserves SDR chromaticity through the shared LUT path", "[auto_hdr]" )
{
	for ( const auto &display : { displaycolorimetry_709, kNativeP3 } )
		for ( const EOTF eotf : { EOTF_Gamma22, EOTF_PQ } )
			for ( const float gain : { 1.0f / 3.0f, 0.5f, 1.0f } )
				for ( const bool planePrecision : { false, true } )
				{
					const auto luts = build_luts( display, eotf, 700.0f, gain, true, planePrecision );
					const auto sdr = build_luts( display, eotf, 700.0f, gain, false, planePrecision );
					const glm::mat3 xyzFromOutput = normalised_primary_matrix( luts.output.primaries, luts.output.white, 1.0f );
					for ( const auto &input : { glm::vec3( 0.25f, 0.1f, 0.05f ), glm::vec3( 1.0f, 0.01f, 0.01f ),
						glm::vec3( 0.9f, 0.45f, 0.1f ), glm::vec3( 0.05f, 0.1f, 0.8f ), glm::vec3( 0.5f ) } )
					{
						CAPTURE( display.primaries.r.x, eotf, gain, planePrecision, input.r, input.g, input.b );
						const glm::vec3 source = xyzFromOutput * sdr.sample( input );
						const glm::vec3 mapped = xyzFromOutput * luts.sample( input );
						const glm::vec2 sourceXY = glm::vec2( source ) / ( source.x + source.y + source.z );
						const glm::vec2 mappedXY = glm::vec2( mapped ) / ( mapped.x + mapped.y + mapped.z );
						REQUIRE( glm::distance( sourceXY, mappedXY ) < 0.003f );
					}
				}
}

TEST_CASE( "Auto HDR applies HDR output gain after tone mapping", "[auto_hdr]" )
{
	for ( const EOTF eotf : { EOTF_Gamma22, EOTF_PQ } )
		for ( const bool planePrecision : { false, true } )
		{
			const float peak = 700.0f;
			float previousMidtone = -1.0f;
			for ( const float gain : { 0.0f, 1.0f / 3.0f, 0.5f, 1.0f } )
			{
				CAPTURE( eotf, gain, planePrecision );
				const auto luts = build_luts( kNativeP3, eotf, peak, gain, true, planePrecision );
				const glm::vec3 white = luts.sample( glm::vec3( 1.0f ) );
				if ( gain == 0.0f )
					REQUIRE( white == glm::vec3( 0.0f ) );
				else
				{
					REQUIRE( white.r > 0.0f );
					REQUIRE( white.r <= luts.peakLimit * 1.001f );
				}
				if ( gain == 1.0f && eotf == EOTF_Gamma22 )
					REQUIRE( white.r == Catch::Approx( peak ) );
				const float midtone = luts.sample( glm::vec3( 0.5f ) ).r;
				REQUIRE( midtone > previousMidtone );
				previousMidtone = midtone;
			}
		}
}

TEST_CASE( "Auto HDR bounds highlights when SDR white exceeds the output peak", "[auto_hdr]" )
{
	for ( const float sdrNits : { 1.0f, 100.0f, 1000.0f } )
		for ( const float targetNits : { 1.0f, 100.0f, 1000.0f } )
		{
			const auto transform = test_transform( glm::mat3( 1.0f ), sdrNits, targetNits );
			const glm::vec3 source = glm::vec3( 1.0f, 0.01f, 0.01f ) * targetNits;
			const glm::vec3 mapped = apply_transform( source, transform );
			for ( const float value : { mapped.r, mapped.g, mapped.b } )
			{
				require_finite( value );
				REQUIRE( value <= targetNits * 1.001f );
			}
			REQUIRE( mapped.r / mapped.g == Catch::Approx( source.r / source.g ) );
		}
}

static double reference_neutral_itm( double input, double sdrNits, double targetNits )
{
	// Invert the forward curve numerically instead of copying the inverse formula.
	const double pSdr = 1.0 + 32.0 * std::pow( sdrNits / 10000.0, 1.0 / 2.4 );
	const double yc = std::log1p( std::pow( std::clamp( input, 0.0, 1.0 ), 1.0 / 2.4 ) * ( pSdr - 1.0 ) ) / std::log( pSdr );
	double low = 0.0, high = 1.0;
	for ( int iteration = 0; iteration < 60; ++iteration )
	{
		const double yp = ( low + high ) * 0.5;
		const double mapped = yp <= 0.7399 ? 1.077 * yp : yp < 0.9909 ?
			( -1.151 * yp + 2.7811 ) * yp - 0.6302 : 0.5 * yp + 0.5;
		if ( mapped < yc )
			low = yp;
		else
			high = yp;
	}
	const double pHdr = 1.0 + 32.0 * std::pow( targetNits / 10000.0, 1.0 / 2.4 );
	return std::pow( std::expm1( ( low + high ) * 0.5 * std::log( pHdr ) ) / ( pHdr - 1.0 ), 2.4 );
}

TEST_CASE( "Auto HDR keeps the neutral BT2446 curve", "[auto_hdr]" )
{
	for ( const float sdrNits : { 80.0f, 203.0f, 500.0f } )
		for ( const float targetNits : { 250.0f, 700.0f, 1200.0f } )
			for ( int step = 0; step <= 256; ++step )
			{
				const float input = step / 256.0f;
				CAPTURE( sdrNits, targetNits, input );
				REQUIRE( armada_autohdr_inverse_tone_map( input, sdrNits, targetNits ) ==
					Catch::Approx( reference_neutral_itm( input, sdrNits, targetNits ) ).epsilon( 0.0005f ).margin( 0.0000001f ) );
			}
}

TEST_CASE( "Auto HDR stays monotonic across the rounded curve joins", "[auto_hdr]" )
{
	const std::array gaps{
		std::array{ 1.077 * 0.7399, ( -1.151 * 0.7399 + 2.7811 ) * 0.7399 - 0.6302 },
		std::array{ ( -1.151 * 0.9909 + 2.7811 ) * 0.9909 - 0.6302, 0.5 * 0.9909 + 0.5 },
	};
	for ( const float sdrNits : { 1.0f, 100.0f, 1000.0f } )
		for ( const float targetNits : { 1.0f, 100.0f, 1000.0f } )
		{
			float previous = 0.0f;
			for ( int step = 1; step <= 65535; ++step )
			{
				const float input = step / 65535.0f;
				const float mapped = armada_autohdr_inverse_tone_map( input, sdrNits, targetNits );
				CAPTURE( sdrNits, targetNits, input, previous, mapped );
				require_finite( mapped );
				REQUIRE( mapped >= previous );
				previous = mapped;
			}
			const double pSdr = 1.0 + 32.0 * std::pow( double( sdrNits ) / 10000.0, 1.0 / 2.4 );
			for ( const auto &gap : gaps )
				for ( const double position : { -0.1, 0.0, 0.25, 0.5, 0.75, 1.0, 1.1 } )
				{
					const double yc = gap[0] + position * ( gap[1] - gap[0] );
					const float input = std::pow( std::expm1( yc * std::log( pSdr ) ) / ( pSdr - 1.0 ), 2.4 );
					CAPTURE( sdrNits, targetNits, yc, input );
					REQUIRE( armada_autohdr_inverse_tone_map( input, sdrNits, targetNits ) ==
						Catch::Approx( reference_neutral_itm( input, sdrNits, targetNits ) ).epsilon( 0.000002f ).margin( 0.000001f ) );
				}
		}
}

TEST_CASE( "Auto HDR gives colors with the same native peak the same gain", "[auto_hdr]" )
{
	for ( const float peak : { 250.0f, 700.0f, 1200.0f } )
		for ( const float maximum : { 0.0f, 0.01f, 0.1f, 0.5f, 1.0f, 2.0f } )
		{
			const auto transform = test_transform( glm::mat3( 1.0f ), 100.0f, peak );
			const glm::vec3 neutral = apply_transform( glm::vec3( maximum * peak ), transform );
			REQUIRE( neutral.r <= peak * 1.00001f );
			if ( maximum >= 1.0f )
				REQUIRE( neutral.r == Catch::Approx( peak ) );
			for ( const auto &ratio : { glm::vec3( 1.0f, 0.0f, 0.0f ), glm::vec3( 0.0f, 1.0f, 0.0f ),
				glm::vec3( 0.0f, 0.0f, 1.0f ), glm::vec3( 1.0f, 0.1f, 0.5f ), glm::vec3( 0.1f, 0.5f, 1.0f ) } )
			{
				CAPTURE( peak, maximum, ratio.r, ratio.g, ratio.b );
				const glm::vec3 mapped = apply_transform( ratio * maximum * peak, transform );
				for ( int channel = 0; channel < 3; ++channel )
					REQUIRE( mapped[channel] == Catch::Approx( neutral[channel] * ratio[channel] ).margin( peak * 0.000001f ) );
			}
		}
}

TEST_CASE( "Auto HDR uses the same native curve and peak in every output gamut", "[auto_hdr]" )
{
	for ( const auto &display : { displaycolorimetry_709, kNativeP3 } )
		for ( const float peak : { 250.0f, 700.0f, 1200.0f } )
			for ( const auto &output : { display, displaycolorimetry_2020 } )
			{
				const glm::mat3 xyzFromNative = normalised_primary_matrix( display.primaries, display.white, 1.0f );
				const glm::mat3 xyzFromOutput = normalised_primary_matrix( output.primaries, output.white, 1.0f );
				const glm::mat3 outputFromNative = glm::inverse( xyzFromOutput ) * xyzFromNative;
				const glm::mat3 nativeFromOutput = glm::inverse( xyzFromNative ) * xyzFromOutput;
				const auto transform = test_transform( nativeFromOutput, 100.0f, peak );
				if ( display == kNativeP3 && output == displaycolorimetry_2020 )
					REQUIRE( ( outputFromNative * glm::vec3( 1.0f, 0.0f, 0.0f ) ).b < 0.0f );
				for ( int r = 0; r <= 16; ++r )
					for ( int g = 0; g <= 16; ++g )
						for ( int b = 0; b <= 16; ++b )
						{
							const glm::vec3 native = glm::vec3( r, g, b ) * ( peak / 16.0f );
							const glm::vec3 mapped = nativeFromOutput * apply_transform( outputFromNative * native, transform );
							const float maximum = std::max( { native.r, native.g, native.b } );
							const double mappedMaximum = reference_neutral_itm( maximum / peak, 100.0f, peak ) * peak;
							const glm::vec3 expected = maximum > 0.0f ? native * float( mappedMaximum / maximum ) : glm::vec3( 0.0f );
							CAPTURE( display.primaries.r.x, output.primaries.r.x, peak, r, g, b );
							for ( int channel = 0; channel < 3; ++channel )
							{
								require_finite( mapped[channel] );
								REQUIRE( mapped[channel] <= peak * 1.00001f );
								REQUIRE( mapped[channel] == Catch::Approx( expected[channel] ).epsilon( 0.0005f ).margin( peak * 0.000003f ) );
							}
						}
			}
}
