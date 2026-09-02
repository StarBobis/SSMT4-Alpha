#include "FastTeamPage.h"

#include "Core/PatternScanner.h"
#include "Core/HookManager.h"
#include "Games/Genshin/GenshinPatterns.h"

namespace SSMT::Tweaks::Genshin::FastTeamPage
{
    namespace
    {
        using CheckCanEnterFn = bool (*)();
        using OpenTeamPageFn = void (*)(bool);
        using OpenTeamFn = void (*)();

        CheckCanEnterFn g_checkCanEnter = nullptr;
        OpenTeamPageFn g_openTeamPage = nullptr;
        OpenTeamFn g_originalOpenTeam = nullptr;
    }

    void Initialize(PatternScanner &patternScanner, std::ostream &log)
    {
        const auto checkCanEnterAddresses =
            patternScanner.FindAll(Patterns::CheckCanEnter);

        const auto openTeamPageAddresses =
            patternScanner.FindAll(Patterns::OpenTeamPage);

        const auto openTeamAddresses =
            patternScanner.FindAll(Patterns::OpenTeam);

        if (checkCanEnterAddresses.size() != 1)
            throw std::runtime_error(
                "FastTeamPage: "
                "checkCanEnter pattern match count is not 1.");

        if (openTeamPageAddresses.size() != 1)
            throw std::runtime_error(
                "FastTeamPage: "
                "OpenTeamPage pattern match count is not 1.");

        if (openTeamAddresses.size() != 1)
            throw std::runtime_error(
                "FastTeamPage: "
                "OpenTeam pattern match count is not 1.");

        // const auto targetAddress = checkCanEnterAddresses.front();
        // PatternScanner::ResolveRelativeCall(checkCanEnterAddresses.front());

        g_checkCanEnter =
            reinterpret_cast<CheckCanEnterFn>(checkCanEnterAddresses.front());

        g_openTeamPage =
            reinterpret_cast<OpenTeamPageFn>(openTeamPageAddresses.front());

        HookManager::Create(
            openTeamAddresses.front(),
            reinterpret_cast<void *>(&HookedOpenTeam),
            reinterpret_cast<void **>(&g_originalOpenTeam));

        log << "CheckCanEnter RVA: 0x"
            << std::hex
            << checkCanEnterAddresses.front() - patternScanner.BaseAddress()
            << '\n'

            << "OpenTeamPage RVA: 0x"
            << std::hex
            << openTeamPageAddresses.front() - patternScanner.BaseAddress()
            << '\n'

            << "OpenTeam RVA: 0x"
            << std::hex
            << openTeamAddresses.front() - patternScanner.BaseAddress()
            << '\n';
    }

    void HookedOpenTeam()
    {
        if (
            g_checkCanEnter != nullptr &&
            g_openTeamPage != nullptr &&
            g_checkCanEnter())
        {
            g_openTeamPage(false);
            return;
        }

        if (g_originalOpenTeam != nullptr)
            g_originalOpenTeam();
    }
} // namespace SSMT::Tweaks::Genshin::FastTeamPage
