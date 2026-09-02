#pragma once

#include "Features/AntiCharacterFade/AntiCharacterFadeConfig.h"
#include "Features/FpsUnlock/FpsUnlockConfig.h"

#include <cstdint>

namespace SSMT::Tweaks::Genshin
{

    struct GenshinConfig
    {
        bool enabled = true;

        FpsUnlockConfig fpsUnlock;
        AntiCharacterFadeConfig antiCharacterFade;
    };

} // namespace SSMT::Tweaks::Genshin
