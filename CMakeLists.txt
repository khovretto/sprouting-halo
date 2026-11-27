cmake_minimum_required(VERSION 3.22)
project(SproutingHalo VERSION 0.2.0 LANGUAGES C CXX)

if(NOT WIN32)
    message(FATAL_ERROR "Sprout targets Windows (Spout, Direct3D 11).")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(SPROUT_JUCE_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/external/JUCE"   CACHE PATH "JUCE checkout (tag 8.0.9)")
set(SPROUT_SPOUT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/external/Spout2" CACHE PATH "Spout2 checkout (tag 2.007.018)")

# ---------------------------------------------------------------------------------------------
# Shared protocol
add_library(sprout_common INTERFACE)
target_include_directories(sprout_common INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/common")
target_compile_definitions(sprout_common INTERFACE NOMINMAX WIN32_LEAN_AND_MEAN UNICODE _UNICODE)

# ---------------------------------------------------------------------------------------------
# Spout (SpoutDX, static, built from the SDK sources)
set(SPOUT_SDK "${SPROUT_SPOUT_DIR}/SPOUTSDK")
add_library(sprout_spoutdx STATIC
    "${SPOUT_SDK}/SpoutDirectX/SpoutDX/SpoutDX.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutCopy.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutDirectX.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutFrameCount.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutSenderNames.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutSharedMemory.cpp"
    "${SPOUT_SDK}/SpoutGL/SpoutUtils.cpp")
target_include_directories(sprout_spoutdx PUBLIC "${SPOUT_SDK}/SpoutDirectX/SpoutDX" "${SPOUT_SDK}/SpoutGL")
target_compile_definitions(sprout_spoutdx PUBLIC SPOUT_BUILD_STATIC)
target_compile_options(sprout_spoutdx PRIVATE /W0)
target_link_libraries(sprout_spoutdx PUBLIC d3d11 dxgi psapi winmm version shlwapi comctl32)

# ---------------------------------------------------------------------------------------------
# Sprout app (renderer + Spout sender)
add_executable(sprout_app WIN32 app/main.cpp app/HaloShaders.h app/FeatureServer.cpp app/FeatureServer.h app/Pitch.h)
target_link_libraries(sprout_app PRIVATE sprout_common sprout_spoutdx d3dcompiler ws2_32)
set_target_properties(sprout_app PROPERTIES OUTPUT_NAME "Sprout")

# Test tools
add_executable(fake_tap tools/fake_tap.cpp)
target_link_libraries(fake_tap PRIVATE sprout_common)

add_executable(pitch_test tools/pitch_test.cpp app/Pitch.h)
target_include_directories(pitch_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/app")

add_executable(spout_snapshot tools/spout_snapshot.cpp)
target_link_libraries(spout_snapshot PRIVATE sprout_spoutdx windowscodecs ole32)

# ---------------------------------------------------------------------------------------------
# Sprout Tap plugin (JUCE, VST3)
option(SPROUT_BUILD_TAP "Build the Sprout Tap plugin" ON)
if(SPROUT_BUILD_TAP)
    add_subdirectory("${SPROUT_JUCE_DIR}" "${CMAKE_BINARY_DIR}/JUCE" EXCLUDE_FROM_ALL)

    juce_add_plugin(SproutTap
        COMPANY_NAME "Sprout"
        PRODUCT_NAME "Sprout Tap"
        PLUGIN_MANUFACTURER_CODE Sprt
        PLUGIN_CODE SpTp
        FORMATS VST3
        IS_SYNTH FALSE
        NEEDS_MIDI_INPUT FALSE
        NEEDS_MIDI_OUTPUT FALSE
        IS_MIDI_EFFECT FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS FALSE
        COPY_PLUGIN_AFTER_BUILD FALSE
        VST3_CATEGORIES Fx Analyzer)

    target_sources(SproutTap PRIVATE tap/SproutTapProcessor.cpp tap/SproutTapProcessor.h tap/ReaperHost.cpp tap/ReaperHost.h)
    target_include_directories(SproutTap PRIVATE "${SPROUT_JUCE_DIR}/modules/juce_audio_processors/format_types/VST3_SDK")
    target_compile_definitions(SproutTap PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_DISPLAY_SPLASH_SCREEN=0)
    target_link_libraries(SproutTap
        PRIVATE
            sprout_common
            juce::juce_audio_utils
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_lto_flags
            juce::juce_recommended_warning_flags)
endif()
