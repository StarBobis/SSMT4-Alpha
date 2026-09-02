#include "GenshinRunTime.h"

#include "Core/PatternScanner.h"
#include "Games/Genshin/Features/AntiCharacterFade/AntiCharacterFade.h"
#include "Games/Genshin/Features/FpsUnlock/FpsUnlock.h"
#include "Games/Genshin/Features/FastTeamPage/FastTeamPage.h"

#include "Games/Genshin/GenshinConfig.h"

#include <ostream>

namespace SSMT::Tweaks::Genshin
{
    void Initialize(
        PatternScanner &patternScanner,
        std::ostream &log)
    {
        const GenshinConfig config{};

        AntiCharacterFade::Initialize(
            patternScanner,
            log);

        FpsUnlock::Initialize(
            patternScanner,
            log);

        FastTeamPage::Initialize(
            patternScanner,
            log);
    }
} // namespace SSMT::Tweaks::Genshin
