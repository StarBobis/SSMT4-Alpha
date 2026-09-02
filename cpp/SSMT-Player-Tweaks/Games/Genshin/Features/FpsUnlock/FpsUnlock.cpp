#include "FpsUnlock.h"

#include "Core/PatternScanner.h"
#include "Core/HookManager.h"
#include "Games/Genshin/GenshinPatterns.h"

#include <cstdint>
#include <ostream>
#include <stdexcept>

#include <wInDoWs.h>
#include <atomic>
#include <filesystem>
#include <fstream>

namespace SSMT::Tweaks::Genshin::FpsUnlock
{
    namespace
    {
        std::ofstream get_log()
        {
            wchar_t localAppData[MAX_PATH]{};
            const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
            if (length == 0 || length >= MAX_PATH)
                throw std::runtime_error("[get log: boom]");
            const std::filesystem::path logPath = std::filesystem::path(localAppData) / L"SSMT4CachedFolder" / L"Logs" / L"SSMT-Player-Tweaks.log";
            return std::ofstream(logPath, std::ios::app);
        }

        std::atomic<std::uint64_t>
            g_getFrameCountCalls{0};

        std::atomic<ULONGLONG>
            g_lastLogTime{0};

        using GetFrameCountFn = std::int32_t (*)();

        using SetFrameCountFn = void (*)(std::int32_t);

        GetFrameCountFn g_originalGetFrameCount = nullptr;

        SetFrameCountFn g_setFrameCount = nullptr;

        using SetSyncCountFn = void (*)(std::int32_t);

        SetSyncCountFn g_originalSetSyncCount = nullptr;

        std::atomic_bool
            g_syncInitialized{false};

        void HookedSetSyncCount(
            std::int32_t /* syncCount */)
        {
            g_originalSetSyncCount(0);
        }
        // SetSyncCountFn g_setSyncCount = nullptr;

        std::int32_t HookedGetFrameCount()
        {

            if (g_originalGetFrameCount == nullptr)
                return 60;

            std::int32_t frameCount =
                g_originalGetFrameCount();

            // 程序启动时 frameCount = -1 (ロゴ画面). 修正するとクラッシュする.
            if (frameCount < 1)
            {
                return frameCount;
            }

            if (
                g_originalSetSyncCount != nullptr &&
                !g_syncInitialized.exchange(true))
            {
                g_originalSetSyncCount(0);
            }

            constexpr std::int32_t targetFrameRate = 120;

            const std::int32_t oldFrameCount = frameCount;

            if (
                g_setFrameCount != nullptr &&
                frameCount != targetFrameRate)
            {
                g_setFrameCount(targetFrameRate);

                frameCount = g_originalGetFrameCount();

                auto currTime = GetTickCount64();

                auto log = get_log();

                if (log.is_open())
                {
                    log << currTime
                        << "[Fps Unlock] "
                        << oldFrameCount
                        << " -> "
                        << frameCount
                        << '\n';
                }
            }

            if (frameCount >= 60)
                return 60;

            if (frameCount >= 45)
                return 45;

            if (frameCount >= 30)
                return 30;

            return frameCount;
        }
    }

    void Initialize(
        PatternScanner &patternScanner,
        std::ostream &log)
    {
        const auto getFrameCountAddresses =
            patternScanner.FindAll(Patterns::GetFrameCount);

        if (getFrameCountAddresses.size() != 1)
            throw std::runtime_error(
                "FpsUnlock: "
                "GetFrameCount pattern match count is not 1.");

        const auto setFrameCountAddresses =
            patternScanner.FindAll(Patterns::SetFrameCount);

        if (setFrameCountAddresses.size() != 1)
            throw std::runtime_error(
                "FpsUnlock: "
                "SetFrameCount pattern match count is not 1.");

        const std::uintptr_t getFrameCountAddress =
            PatternScanner::ResolveRelativeCall(
                getFrameCountAddresses.front());

        const std::uintptr_t setFrameCountAddress =
            PatternScanner::ResolveRelativeCall(
                setFrameCountAddresses.front());

        g_setFrameCount =
            reinterpret_cast<SetFrameCountFn>(setFrameCountAddress);

        const auto setSyncCountAddresses = patternScanner.FindAll(Patterns::SetSyncCount);

        if (setSyncCountAddresses.size() != 1)
            throw std::runtime_error(
                "FpsUnlock: "
                "SetSyncCount pattern match count is not 1.");

        const std::uintptr_t setSyncCountAddress =
            PatternScanner::ResolveRelativeCall(setSyncCountAddresses.front());

        // g_setSyncCount =
        //     reinterpret_cast<SetSyncCountFn>(
        //         setSyncCountAddress);

        HookManager::Create(
            setSyncCountAddress,
            reinterpret_cast<void *>(
                &HookedSetSyncCount),
            reinterpret_cast<void **>(
                &g_originalSetSyncCount));

        log << "SetSyncCount RVA: 0x"
            << std::hex
            << setSyncCountAddress - patternScanner.BaseAddress()
            << '\n';

        HookManager::Create(
            getFrameCountAddress,
            reinterpret_cast<void *>(&HookedGetFrameCount),
            reinterpret_cast<void **>(&g_originalGetFrameCount));

        log << "FpsUnlock functions initialized.\n";
    }
} // namespace SSMT::Tweaks::Genshin::FpsUnlock
