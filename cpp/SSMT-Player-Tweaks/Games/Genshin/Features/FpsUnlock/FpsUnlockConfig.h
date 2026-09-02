#pragma once

#include <cstdint>

namespace SSMT::Tweaks::Genshin
{
    struct FpsUnlockConfig
    {
        bool enabled = true;
        std::int32_t targetFps = 120;
    };
} // namespace SSMT::Tweaks::Genshin
