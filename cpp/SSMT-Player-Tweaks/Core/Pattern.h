#pragma once

#include <cstdint>
#include <vector>

namespace SSMT::Tweaks
{
    struct PatternType
    {
        std::uint8_t value;
        bool wildcard;
    };

    using Pattern = std::vector<PatternType>;

} // namespace SSMT::Tweaks
