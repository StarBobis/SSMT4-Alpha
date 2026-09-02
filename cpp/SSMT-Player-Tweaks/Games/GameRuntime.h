#pragma once

namespace SSMT::Tweaks
{
    enum class GameType
    {
        Unsupported,
        Genshin
    };

    GameType DetectGame();
} // namespace SSMT::Tweaks
