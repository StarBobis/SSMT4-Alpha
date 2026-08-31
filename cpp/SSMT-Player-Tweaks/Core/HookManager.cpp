#pragma once
#include "HookManager.h"
#include <cstdint>
#include <MinHook.h>
#include <stdexcept>
#include <string>

namespace SSMT::Tweaks
{
    void HookManager::Initialize()
    {
        const MH_STATUS status = MH_Initialize();

        if (status == MH_OK)
            return;

        if (status == MH_ERROR_ALREADY_INITIALIZED)
            return;

        throw std::runtime_error(
            std::string("HookManager: MH_Initialize failed: ") + MH_StatusToString(status));
    }
    void HookManager::Uninitialize()
    {
        const MH_STATUS status = MH_Uninitialize();

        if (status == MH_OK)
            return;

        if (status == MH_ERROR_NOT_INITIALIZED)
            return;

        throw std::runtime_error(
            std::string("HookManager: MH_Uninitialize failed: ") + MH_StatusToString(status));
    }
    void HookManager::Create(std::uintptr_t target, void *detour, void **original)
    {
        const MH_STATUS createStatus =
            MH_CreateHook(
                reinterpret_cast<void *>(target),
                detour,
                original);

        if (createStatus != MH_OK)
        {
            throw std::runtime_error(
                std::string("HookManager: MH_CreateHook failed: ") + MH_StatusToString(createStatus));
        }

        const MH_STATUS enableStatus =
            MH_EnableHook(
                reinterpret_cast<void *>(target));

        if (enableStatus != MH_OK)
        {
            throw std::runtime_error(
                std::string("HookManager: MH_EnableHook failed: ") + MH_StatusToString(enableStatus));
        }
    }
}