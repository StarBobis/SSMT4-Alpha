#pragma once

#include <cstdint>
#include <ostream>

namespace SSMT::Tweaks
{
    class PatternScanner;
} // namespace SSMT::Tweaks::Genshin

namespace SSMT::Tweaks::Genshin::FastTeamPage
{

    void Initialize(
        PatternScanner &patternScanner,
        std::ostream &log
    );

    void HookedOpenTeam();
} // namespace SSMT::tweaks::Genshin::FastTeamPage
