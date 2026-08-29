cmake_minimum_required(VERSION 3.24)

project(SSMT4CppTools LANGUAGES CXX RC)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

add_subdirectory(3Dmigoto-Injector-V2)
add_subdirectory(MessageBoxTestDll)
add_subdirectory(SSMT-Player-Tweaks)

# add_custom_command(
#     TARGET 3Dmigoto-Injector-V2
#     POST_BUILD
#     COMMAND ${CMAKE_COMMAND} -E copy_if_different
#         "$<TARGET_FILE:3Dmigoto-Injector-V2>"
#         "${CMAKE_CURRENT_SOURCE_DIR}/../../src-tauri/resources/Run.exe"
# )
