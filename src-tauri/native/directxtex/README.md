# Vendored DirectXTex (x64-windows-static-md)

本目录是 DirectXTex 原生编码器桥接(`src/native_texture_encoder.cpp`)所需的
头文件与静态库的仓库内备份,用于在没有 vcpkg 的环境下也能编译链接(离线、
CI、新克隆仓库开箱即用)。

## 版本与来源

- 包: `directxtex[core,dx11]:x64-windows-static-md@2026-05-07`(DirectXTex may2026)
- 依赖: `directxmath:x64-windows-static-md@2026-06-12`
- 构建器: vcpkg 2026-07-27,MSVC x64(静态库,`/MD` 动态 CRT)
- 安装命令: `vcpkg install directxtex[dx11]:x64-windows-static-md`

## 目录内容

- `include/` — DirectXTex.h/.inl 及 DirectXMath 家族头文件(共 12 个)
- `lib/DirectXTex.lib` — release 静态库(debug 构建同样链接此库)
- `LICENSE-DirectXTex.txt` / `LICENSE-DirectXMath.txt` — MIT 许可文本(随包分发)

## 升级方法

1. 在装有 vcpkg 的机器上: `vcpkg install directxtex[dx11]:x64-windows-static-md`
2. 将 `$VCPKG_ROOT\installed\x64-windows-static-md\include\*` 重新拷贝到 `include/`
3. 将 `$VCPKG_ROOT\installed\x64-windows-static-md\lib\DirectXTex.lib` 重新拷贝到 `lib/`
4. 同步更新 `packages\directxtex_*\share\directxtex\copyright` 至 `LICENSE-DirectXTex.txt`
5. 更新本文档版本号后提交

## 检测优先级(build.rs)

1. `VCPKG_ROOT` 或仓库同级 `D:\Dev\vcpkg` 中的 DirectXTex(允许团队自行升级)
2. 本目录(vendored 兜底,保证任何环境可构建)

注意:本库仅适用于 `x64-windows-static-md` 单一架构/工具链组合,与
`build.rs` 的既有假设一致。