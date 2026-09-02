#include "PatternScanner.h"

#include <stdexcept>
#include <fstream>
#include <filesystem>

namespace SSMT::Tweaks
{
    std::ofstream get_log()
    {
        wchar_t localAppData[MAX_PATH]{};
        const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
        if (length == 0 || length >= MAX_PATH)
            throw std::runtime_error("[get log: boom]");
        const std::filesystem::path logPath = std::filesystem::path(localAppData) / L"SSMT4CachedFolder" / L"Logs" / L"SSMT-Player-Tweaks.log";
        return std::ofstream(logPath, std::ios::app);
    }

    PatternScanner::PatternScanner(HMODULE module)
        : module_(module),
          base_address_(reinterpret_cast<std::uintptr_t>(module)),
          image_size_(0)
    {
        if (module_ == nullptr)
        {
            throw std::invalid_argument("PatternScanner: module is null.");
        }

        const auto *dosHeader = reinterpret_cast<const IMAGE_DOS_HEADER *>(base_address_);
        if (dosHeader->e_magic != IMAGE_DOS_SIGNATURE)
        {
            throw std::runtime_error("PatternScanner: invalid DOS header.");
        }

        const auto *ntHeaders = reinterpret_cast<const IMAGE_NT_HEADERS64 *>(
            base_address_ + dosHeader->e_lfanew);

        if (ntHeaders->Signature != IMAGE_NT_SIGNATURE)
        {
            throw std::runtime_error("PatternScanner: invalid NT header.");
        }

        if (ntHeaders->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
        {
            throw std::runtime_error("PatternScanner: module is not a 64-bit PE image.");
        }

        image_size_ = ntHeaders->OptionalHeader.SizeOfImage;

        const IMAGE_SECTION_HEADER *sections = IMAGE_FIRST_SECTION(ntHeaders);

        for (WORD i = 0; i < ntHeaders->FileHeader.NumberOfSections; ++i)
        {
            const auto &section = sections[i];

            const bool isExecutable =
                (section.Characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;

            const bool containsCode =
                (section.Characteristics & IMAGE_SCN_CNT_CODE) != 0;

            if (isExecutable && containsCode)
            {
                executable_sections_.push_back({base_address_ + section.VirtualAddress,
                                                section.Misc.VirtualSize});
            }
        }

        if (executable_sections_.empty())
            throw std::runtime_error(
                "PatternScanner: no executable code sections found.");

        auto log = get_log();

        DumpSections(log);
    }

    std::uintptr_t PatternScanner::BaseAddress() const
    {
        return base_address_;
    }

    std::size_t PatternScanner::ImageSize() const
    {
        return image_size_;
    }
    void PatternScanner::DumpSections(std::ostream &output) const
    {
        const auto *dosHeader = reinterpret_cast<const IMAGE_DOS_HEADER *>(
            base_address_);

        const auto *ntHeaders = reinterpret_cast<const IMAGE_NT_HEADERS64 *>(
            base_address_ + dosHeader->e_lfanew);

        const IMAGE_SECTION_HEADER *sections =
            IMAGE_FIRST_SECTION(ntHeaders);

        for (WORD i = 0; i < ntHeaders->FileHeader.NumberOfSections; ++i)
        {
            const auto &section = sections[i];

            char name[IMAGE_SIZEOF_SHORT_NAME + 1]{};

            std::memcpy(
                name,
                section.Name,
                IMAGE_SIZEOF_SHORT_NAME);

            output
                << name
                << " VA=0x"
                << std::hex
                << section.VirtualAddress
                << '\n'

                << " VirtualSize=0x"
                << section.SizeOfRawData

                << " Characteristics=0x"
                << section.Characteristics

                << '\n'
                << '\n';

            output
                << " RawOffset=0x"
                << section.PointerToRawData
                << " RawSize=0x"
                << section.SizeOfRawData
                << '\n';
        }
    }

    std::uint8_t PatternScanner::HexDigit(char c)
    {
        if (c >= '0' && c <= '9')
        {
            return static_cast<std::uint8_t>(c - '0');
        }

        if (c >= 'A' && c <= 'F')
        {
            return static_cast<std::uint8_t>(c - 'A' + 10);
        }

        if (c >= 'a' && c <= 'f')
        {
            return static_cast<std::uint8_t>(c - 'a' + 10);
        }

        throw std::invalid_argument(
            "PatternScanner: invalid hexadecimal digit.");
    }
    std::uintptr_t PatternScanner::Find(std::string_view patternText) const
    {
        const Pattern pattern = ParsePattern(patternText);

        if (pattern.empty())
        {
            throw std::invalid_argument(
                "PatternScanner: pattern is empty.");
        }

        for (const auto &section : executable_sections_)
        {
            if (section.size < pattern.size())
            {
                continue;
            }

            const auto *begin = reinterpret_cast<const std::uint8_t *>(
                section.address);

            const std::size_t lastStart = section.size - pattern.size();

            for (std::size_t offset = 0; offset <= lastStart; ++offset)
            {
                const auto *current = begin + offset;

                if (MatchAt(current, pattern))
                {
                    return reinterpret_cast<std::uintptr_t>(
                        current);
                }
            }
        }
        return 0;
    }
    std::vector<std::uintptr_t> PatternScanner::FindAll(std::string_view patternText) const
    {
        const Pattern pattern = ParsePattern(patternText);

        std::vector<std::uintptr_t> result{};

        if (pattern.empty())
        {
            throw std::invalid_argument(
                "PatternScanner: pattern is empty.");
        }

        for (const auto &section : executable_sections_)
        {
            if (section.size < pattern.size())
            {
                continue;
            }

            const auto *begin = reinterpret_cast<const std::uint8_t *>(
                section.address);

            const std::size_t lastStart = section.size - pattern.size();

            for (std::size_t offset = 0; offset <= lastStart; ++offset)
            {
                const auto *current = begin + offset;

                if (MatchAt(current, pattern))
                {
                    result.push_back(reinterpret_cast<std::uintptr_t>(
                        current));
                }
            }
        }
        return result;
    }
    auto PatternScanner::IsExecutableAddress(std::uintptr_t address) const
    {
        for (const auto &section : executable_sections_)
        {
            const auto begin = section.address;
            const auto end = section.address + section.size;

            if (address >= begin && address < end)
            {
                return true;
            }
        }
        return false;
    }
    std::uintptr_t PatternScanner::ResolveRelativeCall(
        std::uintptr_t address)
    {
        const std::int32_t displacement =
            *reinterpret_cast<const std::int32_t *>(
                address + 1);

        const std::uintptr_t nextInstruction =
            address + 5;

        const std::intptr_t signedNextInstruction =
            static_cast<std::intptr_t>(
                nextInstruction);

        const std::intptr_t target =
            signedNextInstruction + static_cast<std::intptr_t>(
                                        displacement);

        return static_cast<std::uintptr_t>(
            target);
    }
    Pattern PatternScanner::ParsePattern(std::string_view pattern)
    {
        Pattern result;

        for (std::size_t i = 0; i < pattern.size();)
        {
            if (pattern[i] == ' ')
            {
                ++i;
                continue;
            }

            if (
                i + 1 < pattern.size() &&
                pattern[i] == '?' &&
                pattern[i + 1] == '?')
            {
                result.push_back({0,
                                  true});

                i += 2;
                continue;
            }

            if (i + 1 >= pattern.size())
            {
                throw std::invalid_argument(
                    "PatternScanner: incomplete hex byte.");
            }

            const auto high = HexDigit(pattern[i]);
            const auto low = HexDigit(pattern[i + 1]);

            const auto value = static_cast<std::uint8_t>(
                (high << 4) | low);

            result.push_back({value,
                              false});

            i += 2;
        }

        return result;
    }
    bool PatternScanner::MatchAt(const std::uint8_t *address, const Pattern &pattern)
    {
        for (std::size_t i = 0; i < pattern.size(); ++i)
        {
            const auto &patternByte = pattern[i];

            if (patternByte.wildcard)
            {
                continue;
            }

            if (address[i] != patternByte.value)
            {
                return false;
            }
        }
        return true;
    }
}