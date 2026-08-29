#include <Windows.h>

#include "Core/Bootstrap.h"

BOOL APIENTRY DllMain(
    HMODULE module,
    DWORD reason,
    LPVOID reserved
) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(module);

        HANDLE thread = CreateThread(
            nullptr,
            0,
            SSMT::Tweaks::BootstrapThread,
            module,
            0,
            nullptr
        );

        if (thread != nullptr) {
            CloseHandle(thread);
        }
    }

    return TRUE;
}