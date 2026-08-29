#pragma once

#include <Windows.h>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <ostream>
#include <vector>
#include <string_view>
#include "Pattern.h"

namespace SSMT::Tweaks
{
    struct SectionRange
    {
        std::uintptr_t address;
        std::size_t size;
    };

    class PatternScanner
    {
    public:
        explicit PatternScanner(HMODULE module);

        [[nodiscard]]
        std::uintptr_t BaseAddress() const;
        [[nodiscard]]
        std::size_t ImageSize() const;

        [[nodiscard]]
        void DumpSections(std::ostream &output) const;

        [[nodiscard]]
        static std::uint8_t HexDigit(char c) const;

        [[nodiscard]]
        std::uintptr_t Find(std::string_view pattern) const;

    private:
        HMODULE module_;
        std::uintptr_t base_address_;
        std::size_t image_size_;

        std::vector<SectionRange> executable_sections_;

        static Pattern ParsePattern(std::string_view pattern);

        static bool MatchAt(
            const std::uint8_t* address,
            const Pattern& pattern
        );
    };

}