#include "AntiCharacterFade.h"

#include "Core/PatternScanner.h"
#include "Core/HookManager.h"
#include "Games/Genshin/GenshinPatterns.h"

#include <cstdint>
#include <ostream>
#include <stdexcept>

namespace SSMT::Tweaks::Genshin::AntiCharacterFade
{
    namespace
    {
        using PlayerPerspectiveFn = void (*)(void *, float);

        PlayerPerspectiveFn g_originalPlayerPerspective = nullptr;

        void HookedPlayerPerspective(
            void *object,
            float value)
        {
            g_originalPlayerPerspective(
                object,
                1.0f);
        }
    }

    void Initialize(
        PatternScanner &patternScanner,
        std::ostream &log)
    {
        const auto addresses = patternScanner.FindAll(Patterns::PlayerPerspective);

        if (addresses.size() != 1)
            throw std::runtime_error(
                "AntiCharacterFade: "
                "PlayerPerspective pattern match count is not 1.");

        const std::uintptr_t targetAddress = PatternScanner::ResolveRelativeCall(addresses.front());

        log << "PlayerPerspective RVA: 0x"
            << std::hex
            << targetAddress - patternScanner.BaseAddress()
            << '\n';

        HookManager::Create(
            targetAddress,
            reinterpret_cast<void *>(
                &HookedPlayerPerspective),
            reinterpret_cast<void **>(
                &g_originalPlayerPerspective));

        log << "AntiCharacterFade hook enabled.\n";
    }
}