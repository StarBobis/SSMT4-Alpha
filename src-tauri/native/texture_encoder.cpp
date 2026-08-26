#include <DirectXTex.h>
#include <objbase.h>
#include <cstring>
#include <cstdio>
#include <string>

static DXGI_FORMAT parse_format(const char* value) {
    if (!std::strcmp(value, "BC1_UNORM")) return DXGI_FORMAT_BC1_UNORM;
    if (!std::strcmp(value, "BC1_UNORM_SRGB")) return DXGI_FORMAT_BC1_UNORM_SRGB;
    if (!std::strcmp(value, "BC2_UNORM")) return DXGI_FORMAT_BC2_UNORM;
    if (!std::strcmp(value, "BC2_UNORM_SRGB")) return DXGI_FORMAT_BC2_UNORM_SRGB;
    if (!std::strcmp(value, "BC3_UNORM")) return DXGI_FORMAT_BC3_UNORM;
    if (!std::strcmp(value, "BC3_UNORM_SRGB")) return DXGI_FORMAT_BC3_UNORM_SRGB;
    if (!std::strcmp(value, "BC4_UNORM")) return DXGI_FORMAT_BC4_UNORM;
    if (!std::strcmp(value, "BC4_SNORM")) return DXGI_FORMAT_BC4_SNORM;
    if (!std::strcmp(value, "BC5_UNORM")) return DXGI_FORMAT_BC5_UNORM;
    if (!std::strcmp(value, "BC5_SNORM")) return DXGI_FORMAT_BC5_SNORM;
    if (!std::strcmp(value, "BC6H_UF16")) return DXGI_FORMAT_BC6H_UF16;
    if (!std::strcmp(value, "BC6H_SF16")) return DXGI_FORMAT_BC6H_SF16;
    if (!std::strcmp(value, "BC7_UNORM")) return DXGI_FORMAT_BC7_UNORM;
    if (!std::strcmp(value, "BC7_UNORM_SRGB")) return DXGI_FORMAT_BC7_UNORM_SRGB;
    return DXGI_FORMAT_R8G8B8A8_UNORM;
}

static void set_error(char* error, size_t capacity, const char* message, HRESULT hr) {
    if (!error || !capacity) return;
    std::snprintf(error, capacity, "%s (HRESULT 0x%08X)", message, static_cast<unsigned>(hr));
}

extern "C" int ssmt_encode_rgba_dds(const uint8_t* pixels, uint32_t width, uint32_t height,
    const char* format_name, bool quick, const wchar_t* output_path, char* error, size_t error_capacity) {
    if (!pixels || !width || !height || !format_name || !output_path) return -1;
    thread_local const HRESULT com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(com) && com != RPC_E_CHANGED_MODE) { set_error(error, error_capacity, "COM initialization failed", com); return 5; }
    DirectX::Image source{width, height, DXGI_FORMAT_R8G8B8A8_UNORM,
        static_cast<size_t>(width) * 4, static_cast<size_t>(width) * height * 4,
        const_cast<uint8_t*>(pixels)};
    DirectX::ScratchImage mipmaps;
    HRESULT hr = DirectX::GenerateMipMaps(source, DirectX::TEX_FILTER_DEFAULT, 0, mipmaps);
    if (FAILED(hr)) { set_error(error, error_capacity, "GenerateMipMaps failed", hr); return 1; }
    const auto format = parse_format(format_name);
    DirectX::ScratchImage compressed;
    // DirectXTex's DirectCompute BC6/BC7 path can stop returning on some
    // driver/device combinations.  The CPU codec is deterministic and its
    // parallel flag keeps all cores busy without overlapping unsafe GPU calls.
    auto flags = DirectX::TEX_COMPRESS_PARALLEL;
    if (quick && (format == DXGI_FORMAT_BC7_UNORM || format == DXGI_FORMAT_BC7_UNORM_SRGB)) {
        flags = static_cast<DirectX::TEX_COMPRESS_FLAGS>(flags | DirectX::TEX_COMPRESS_BC7_QUICK);
    }
    hr = DirectX::Compress(mipmaps.GetImages(), mipmaps.GetImageCount(), mipmaps.GetMetadata(),
        format, flags, 1.f, compressed);
    if (FAILED(hr)) { set_error(error, error_capacity, "Compress failed", hr); return 3; }
    hr = DirectX::SaveToDDSFile(compressed.GetImages(), compressed.GetImageCount(), compressed.GetMetadata(), DirectX::DDS_FLAGS_NONE, output_path);
    if (FAILED(hr)) { set_error(error, error_capacity, "SaveToDDSFile failed", hr); return 4; }
    return 0;
}
