cmake_minimum_required(VERSION 3.20)

project(SSMTPlayerTweaks LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(
    ${CMAKE_CURRENT_SOURCE_DIR}/ThirdParty/MinHook
    ${CMAKE_CURRENT_BINARY_DIR}/MinHook
)

add_library(SSMT-Player-Tweaks SHARED
    dllMain.cpp

    Core/Bootstrap.cpp
    Core/Bootstrap.h

    Core/HookManager.cpp
    Core/HookManager.h

    Core/PatternScanner.cpp
    Core/PatternScanner.h

    Core/Pattern.h

    Games/Genshin/GenshinPatterns.cpp
    Games/Genshin/GenshinPatterns.h

    Games/Genshin/Features/AntiCharacterFade.cpp
    Games/Genshin/Features/AntiCharacterFade.h
)

target_include_directories(SSMT-Player-Tweaks PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/Core
    ${CMAKE_CURRENT_SOURCE_DIR}/Games/Genshin
)

target_link_libraries(SSMT-Player-Tweaks PRIVATE
    minhook
)

target_include_directories(SSMT-Player-Tweaks PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)