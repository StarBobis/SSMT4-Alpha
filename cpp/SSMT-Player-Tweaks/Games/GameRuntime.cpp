#include "GameRuntime.h"

#include <Windows.h>
#include <filesystem>
#include <string>
#include <algorithm>
#include <cwctype>

namespace SSMT::Tweaks
{
    GameType DetectGame()
    {
        wchar_t exePath[MAX_PATH]{};

        const DWORD length =
            GetModuleFileNameW(
                nullptr,
                exePath,
                MAX_PATH);

        if (length == 0 || length >= MAX_PATH)
            return GameType::Unsupported;

        const std::wstring exeName =
            std::filesystem::path(exePath)
                .filename()
                .wstring();

        if (
            _wcsicmp(
                exeName.c_str(),
                L"YuanShen.exe") == 0 ||
            _wcsicmp(
                exeName.c_str(),
                L"GenshinImpact.exe") == 0

        )
        {
            return GameType::Genshin;
        }
        return GameType::Unsupported;
    }
}