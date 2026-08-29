cmake_minimum_required(VERSION 3.20)

project(SSMTPlayerTweaks LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(SSMT-Player-Tweaks SHARED
    dllMain.cpp
    Core/PatternScanner.cpp
    Core/Bootstrap.cpp
)

target_include_directories(SSMT-Player-Tweaks PRIVATE
    $(CMAKE_CURRENT_SOURCE_DIR)
)