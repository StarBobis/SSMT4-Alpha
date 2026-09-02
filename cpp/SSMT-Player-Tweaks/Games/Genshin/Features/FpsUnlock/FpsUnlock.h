#pragma once

#include <iosfwd>

namespace SSMT::Tweaks
{
    class PatternScanner;
} // namespace SSMT::Tweaks::Genshin

namespace SSMT::Tweaks::Genshin::FpsUnlock
{
    void Initialize(
        PatternScanner &patternScanner,
        std::ostream &log
    );
} // namespace SSMT::tweaks::Genshin::FpsUnlock
