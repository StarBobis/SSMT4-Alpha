#pragma once

namespace SSMT::Tweaks
{
    using PlayerPerspectiveFn = void (*)(void *, float);

    extern PlayerPerspectiveFn g_originalPlayerPerspective;

    void HookedPlayerPerspective(
        void *object,
        float value);
} // namespace SSMT::Tweaks
