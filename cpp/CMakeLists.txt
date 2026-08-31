cmake_minimum_required(VERSION 3.24)

project(SSMT4CppTools LANGUAGES C CXX RC)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY
        "MultiThreaded$<$<CONFIG:Debug>:Debug>"
    )
endif()

add_subdirectory(3Dmigoto-Injector-V2)
add_subdirectory(MessageBoxTestDll)
add_subdirectory(SSMT-Player-Tweaks)

set(SSMT_RESOURCES_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../src-tauri/resources"
)

add_custom_target(DeploySSMTCpp ALL
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:3Dmigoto-Injector-V2>"
        "${SSMT_RESOURCES_DIR}/Run.exe"

    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:SSMT-Player-Tweaks>"
        "${SSMT_RESOURCES_DIR}/SSMT-Player-Tweaks.dll"

    COMMENT "Deploying SSMT C++ binaries"
)

add_dependencies(
    DeploySSMTCpp
    3Dmigoto-Injector-V2
    SSMT-Player-Tweaks
)