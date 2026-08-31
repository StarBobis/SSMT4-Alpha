#include "AntiCharacterFade.h"

namespace SSMT::Tweaks
{
    PlayerPerspectiveFn g_originalPlayerPerspective = nullptr;

    void SSMT::Tweaks::HookedPlayerPerspective(void *object, float value)
    {
        g_originalPlayerPerspective(
            object,
            1.0f);
    }
}