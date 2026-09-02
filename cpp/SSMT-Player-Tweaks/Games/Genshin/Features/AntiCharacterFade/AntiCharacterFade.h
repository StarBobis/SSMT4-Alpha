#pragma once
#include <iosfwd>

namespace SSMT::Tweaks
{
    class PatternScanner;
} // namespace SSMT::Tweaks

namespace SSMT::Tweaks::Genshin::AntiCharacterFade
{
    void Initialize(
        PatternScanner &patternsScanner,
        std::ostream &log);
} // namespace SSMT::Tweaks::Genshin::AntiCharacterFade
