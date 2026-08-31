#pragma once
#include "PatternScanner.h"
#include "HookManager.h"
#include "GenshinPatterns.h"
#include <cstdint>

namespace SSMT::Tweaks
{
    class HookManager
    {
    public:
        static void Initialize();
        static void Uninitialize();

        static void Create(
            std::uintptr_t target,
            void* detour,
            void** original
        );
    };
}