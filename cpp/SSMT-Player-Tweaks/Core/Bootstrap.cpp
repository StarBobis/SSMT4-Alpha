#include "Bootstrap.h"
#include "PatternScanner.h"
#include "HookManager.h"
#include "Games/Genshin/Features/AntiCharacterFade.h"
#include <filesystem>
#include <fstream>
#include <string>
#include <algorithm>

namespace SSMT::Tweaks
{
    DWORD WINAPI BootstrapThread(LPVOID parameter)
    {
        const auto selfModule = static_cast<HMODULE>(parameter);

        wchar_t localAppData[MAX_PATH]{};

        const DWORD length = GetEnvironmentVariableW(
            L"LOCALAPPDATA",
            localAppData,
            static_cast<DWORD>(std::size(localAppData)));

        if (length == 0 || length >= std::size(localAppData))
            return 1;

        const std::filesystem::path logDirectory =
            std::filesystem::path(localAppData) / L"SSMT4CachedFolder" / L"Logs";

        std::filesystem::create_directories(logDirectory);

        const auto logPath =
            logDirectory / L"SSMT-Player-Tweaks.log";

        std::ofstream log(
            logPath,
            std::ios::trunc);

        if (!log.is_open())
            return 1;

        try
        {
            const HMODULE gameModule = GetModuleHandleW(nullptr);

            if (gameModule == nullptr)
            {
                throw std::runtime_error(
                    "Bootstrap: game module is null.");
            }

            HookManager::Initialize();

            log << "MinHook initialized.\n";

            PatternScanner patternScanner(
                gameModule);

            const auto addresses = patternScanner.FindAll(
                "E8 ?? ?? ?? ?? 48 8B BE ?? ?? ?? ?? "
                "80 3D ?? ?? ?? ?? ?? "
                "0F 85 ?? ?? ?? ?? "
                "80 BE ?? ?? ?? ?? ?? 74 11");

            if (addresses.size() != 1)
            {
                throw std::runtime_error(
                    "AntiCharacterFade: "
                    "PlayerPerspective pattern match count is not 1.");
            }

            const std::uintptr_t targetAddress = PatternScanner::ResolveRelativeCall(
                addresses.front());

            wchar_t modulePath[MAX_PATH]{};

            GetModuleFileNameW(
                selfModule,
                modulePath,
                static_cast<DWORD>(std::size(modulePath)));

            const std::filesystem::path dllPath{modulePath};

            HookManager::Create(
                targetAddress,
                reinterpret_cast<void *>(&HookedPlayerPerspective),
                reinterpret_cast<void **>(&g_originalPlayerPerspective));
        }
        catch (const std::exception &exception)
        {
            log << "Fatal Error: "
                << exception.what()
                << '\n';

            return 1;
        }

        return 0;

        // const HMODULE gameModule = GetModuleHandleW(nullptr);

        // if (gameModule == nullptr)
        //     return 1;

        // HookManager::Initialize();

        // PatternScanner patternScanner(gameModule);

        // const auto addresses = patternScanner.FindAll(
        //     "E8 ?? ?? ?? ?? 48 8B BE ?? ?? ?? ?? "
        //     "80 3D ?? ?? ?? ?? ?? "
        //     "0F 85 ?? ?? ?? ?? "
        //     "80 BE ?? ?? ?? ?? ?? 74 11");

        // const std::uintptr_t targetAddress =
        //     PatternScanner::ResolveRelativeCall(
        //         addresses.front());

        // wchar_t modulePath[MAX_PATH]{};

        // GetModuleFileNameW(
        //     selfModule,
        //     modulePath,
        //     static_cast<DWORD>(std::size(modulePath)));

        // const std::filesystem::path dllPath{modulePath};

        // const auto logPath =
        //     dllPath.parent_path() / L"SSMT-Player-Tweaks.log";

        // std::ofstream log(logPath, std::ios::trunc);

        // if (log.is_open())
        // {

        //     log << "SSMT Player Tweaks loaded.\n";

        //     log << "Base address: 0x"
        //         << std::hex
        //         << patternScanner.BaseAddress()
        //         << '\n';

        //     log << "Image size: 0x"
        //         << patternScanner.ImageSize()
        //         << '\n';

        //     log << "\nSections:\n";

        //     patternScanner.DumpSections(log);

        //     log << '\n';

        //     log << "Pattern matches: "
        //         << addresses.size()
        //         << '\n';

        //     for (std::size_t i = 0;
        //          i < std::min<std::size_t>(addresses.size(), 10);
        //          ++i)
        //     {
        //         log << "Match[" << i << "] RVA: 0x"
        //             << std::hex
        //             << addresses[i] - patternScanner.BaseAddress()
        //             << '\n';
        //     }

        //     if (addresses.size() == 1)
        //     {

        //         log << "Target address: 0x"
        //             << std::hex
        //             << targetAddress
        //             << '\n';

        //         log << "Target RVA: 0x"
        //             << targetAddress - patternScanner.BaseAddress()
        //             << '\n';
        //     }
        // }
        // else
        // {
        //     return 1;
        // }

        // return 0;
    }
}