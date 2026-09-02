#pragma once

#include <iosfwd>

namespace SSMT::Tweaks
{
    class PatternScanner;

    namespace Genshin
    {
        void Initialize(
            PatternScanner &patternScanner,
            std::ostream &log
        );
    } // namespace Genshin
    
} // namespace SSMT::Tweaks
