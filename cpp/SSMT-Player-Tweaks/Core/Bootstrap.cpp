#include "Bootstrap.h"
#include "PatternScanner.h"
#include <filesystem>
#include <fstream>
#include <string>

namespace SSMT::Tweaks
{
    DWORD WINAPI BootstrapThread(LPVOID parameter)
    {
        const auto selfModule = static_cast<HMODULE>(parameter);

        const HMODULE gameModule = GetModuleHandleW(nullptr);

        if (gameModule == nullptr)
            return 1;

        wchar_t gamePath[MAX_PATH]{};

        GetModuleFileNameW(
            gameModule,
            gamePath,
            static_cast<DWORD>(std::size(gamePath)));

        const auto patternScanner = PatternScanner::PatternScanner(
            gameModule);

        wchar_t modulePath[MAX_PATH]{};

        GetModuleFileNameW(
            selfModule,
            modulePath,
            static_cast<DWORD>(std::size(modulePath)));

        const std::filesystem::path dllPath{modulePath};

        const auto logPath =
            dllPath.parent_path() / L"SSMT-Player-Tweaks.log";

        std::ofstream log(logPath, std::ios::trunc);

        if (log.is_open())
        {

            log << "SSMT Player Tweaks loaded.\n";

            log << "Base address: 0x"
                << std::hex
                << patternScanner.BaseAddress()
                << '\n';

            log << "Image size: 0x"
                << patternScanner.ImageSize()
                << '\n';

            log << "\nSections:\n";

            patternScanner.DumpSections(log);

            std::wofstream log(logPath, std::ios::app);
        }

        return 0;
    }
}