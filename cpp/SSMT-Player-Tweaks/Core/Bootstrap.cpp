#include "Bootstrap.h"
#include "PatternScanner.h"
#include "HookManager.h"
#include "Games/Genshin/GenshinRunTime.h"
#include "Games/GameRuntime.h"
#include <filesystem>
#include <fstream>
#include <string>
#include <algorithm>

namespace SSMT::Tweaks
{
    DWORD WINAPI BootstrapThread(LPVOID parameter)
    {

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
        else
        {
            const ULONGLONG now =
                GetTickCount64();

            log << "Start Time: "
                << now
                << '\n';
        }

        try
        {
            const HMODULE gameModule = GetModuleHandleW(nullptr);

            if (gameModule == nullptr)
            {
                throw std::runtime_error(
                    "Bootstrap: game module is null.");
            }

            const GameType gameType = DetectGame();

            if (gameType == GameType::Unsupported)
            {
                log << "Unsupported game. "
                       "No player tweaks initialized.\n";

                return 0;
            }

            HookManager::Initialize();

            log << "MinHook initialized.\n";

            PatternScanner patternScanner(
                gameModule);

            switch (gameType)
            {
            case GameType::Genshin:
                log << "Game detected: Genshin Impact.\n";

                Genshin::Initialize(
                    patternScanner,
                    log);

                break;

            // case GameType::StarRail:
            //     log << "Game detected: Honkai Star Rail.\n";

            //     StarRail::Initialize(
            //         patternScanner,
            //         log);

            default:
                break;
            }
        }
        catch (const std::exception &exception)
        {
            log << "Fatal Error: "
                << exception.what()
                << '\n';

            return 1;
        }

        return 0;
    }
}