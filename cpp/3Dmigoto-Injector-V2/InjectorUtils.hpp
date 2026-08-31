#pragma once

#include <windows.h>
#include <stdio.h>
#include <tlhelp32.h>
#include <set>
#include <string>

class InjectorUtils
{
public:
    static wchar_t *DeduceWorkingDirectory(wchar_t *setting, wchar_t dir[MAX_PATH])
    {
        wchar_t *filePart = nullptr;
        DWORD ret = GetFullPathNameW(setting, MAX_PATH, dir, &filePart);
        if (!ret || ret >= MAX_PATH)
        {
            return nullptr;
        }

        ret = GetFileAttributesW(dir);
        if (ret == INVALID_FILE_ATTRIBUTES)
        {
            return nullptr;
        }

        if (!(ret & FILE_ATTRIBUTE_DIRECTORY) && filePart)
        {
            *filePart = L'\0';
        }

        printf("Using working directory: \"%S\"\n", dir);
        return dir;
    }

    static bool WaitForTarget(const char *target, const wchar_t *modulePath, bool wait, int delay, bool launched)
    {
        wchar_t targetW[MAX_PATH] = {};
        if (!MultiByteToWideChar(CP_UTF8, 0, target, -1, targetW, MAX_PATH))
        {
            return false;
        }

        bool found = false;
        for (int seconds = 0; wait || delay == -1; ++seconds)
        {
            found = CheckForRunningTarget(targetW, modulePath) || found;
            if (found && delay != -1)
            {
                break;
            }

            Sleep(1000);
            if (launched && seconds == 3)
            {
                printf("\nStill waiting for the game to start...\n"
                       "If the game does not launch automatically, leave this window open and run it manually.\n"
                       "You can also adjust/remove the [Loader] launch= option in d3dx.ini as desired.\n\n");
            }
        }

        for (int i = delay; i > 0; --i)
        {
            printf("Shutting down loader in %i...\r", i);
            Sleep(1000);
            found = CheckForRunningTarget(targetW, modulePath) || found;
        }
        printf("\n");

        return found;
    }

private:
    static bool CheckForRunningTarget(wchar_t *target, const wchar_t *modulePath)
    {
        wchar_t *basename = wcsrchr(target, L'\\');
        basename = basename ? basename + 1 : target;

        HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == INVALID_HANDLE_VALUE)
        {
            printf("Unable to verify if 3DMigoto was loaded: %lu\n", GetLastError());
            return false;
        }

        PROCESSENTRY32W pe = {};
        pe.dwSize = sizeof(pe);
        if (!Process32FirstW(snapshot, &pe))
        {
            printf("Unable to enumerate processes: %lu\n", GetLastError());
            CloseHandle(snapshot);
            return false;
        }

        bool ok = false;
        static std::set<DWORD> seenPids;
        do
        {
            if (_wcsicmp(pe.szExeFile, basename) != 0)
            {
                continue;
            }

            ok = VerifyInjection(&pe, modulePath, !seenPids.count(pe.th32ProcessID)) || ok;
            seenPids.insert(pe.th32ProcessID);
        } while (Process32NextW(snapshot, &pe));

        CloseHandle(snapshot);
        return ok;
    }

    static bool VerifyInjection(PROCESSENTRY32W *pe, const wchar_t *modulePath, bool logName)
    {
        const wchar_t *moduleBase = wcsrchr(modulePath, L'\\');
        moduleBase = moduleBase ? moduleBase + 1 : modulePath;

        HANDLE snapshot = INVALID_HANDLE_VALUE;
        do
        {
            snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pe->th32ProcessID);
        } while (snapshot == INVALID_HANDLE_VALUE && GetLastError() == ERROR_BAD_LENGTH);

        if (snapshot == INVALID_HANDLE_VALUE)
        {
            DWORD lastError = GetLastError();
            if (lastError == ERROR_ACCESS_DENIED)
            {
                printf("%lu: target process found, but module verification was denied; assuming success.\n", pe->th32ProcessID);
                return true;
            }
            printf("%S (%lu): unable to verify module load: %lu\n", pe->szExeFile, pe->th32ProcessID, lastError);
            return false;
        }

        MODULEENTRY32W me = {};
        me.dwSize = sizeof(me);
        if (!Module32FirstW(snapshot, &me))
        {
            DWORD lastError = GetLastError();
            CloseHandle(snapshot);
            if (lastError == ERROR_ACCESS_DENIED)
            {
                printf("%lu: module verification denied; assuming success.\n", pe->th32ProcessID);
                return true;
            }
            printf("%S (%lu): unable to enumerate modules: %lu\n", pe->szExeFile, pe->th32ProcessID, lastError);
            return false;
        }

        wchar_t exeDir[MAX_PATH] = {};
        wcscpy_s(exeDir, MAX_PATH, me.szExePath);
        wchar_t *exeSlash = wcsrchr(exeDir, L'\\');
        if (exeSlash)
        {
            exeSlash[1] = L'\0';
        }

        if (logName)
        {
            printf("Target process found (%lu): %S\n", pe->th32ProcessID, me.szExePath);
        }

        bool loaded = false;
        do
        {
            if (_wcsicmp(me.szModule, moduleBase) != 0)
            {
                continue;
            }

            if (_wcsicmp(me.szExePath, modulePath) == 0)
            {
                printf("%lu: 3DMigoto loaded.\n", pe->th32ProcessID);
                loaded = true;
                continue;
            }

            wchar_t moduleDir[MAX_PATH] = {};
            wcscpy_s(moduleDir, MAX_PATH, me.szExePath);
            wchar_t *moduleSlash = wcsrchr(moduleDir, L'\\');
            if (moduleSlash)
            {
                moduleSlash[1] = L'\0';
            }

            if (_wcsicmp(exeDir, moduleDir) == 0)
            {
                printf("\nWARNING: Found another 3DMigoto copy loaded from the game directory:\n%S\n"
                       "Please remove that copy and try again.\n\n",
                       me.szExePath);
                CloseHandle(snapshot);
                return false;
            }
        } while (Module32NextW(snapshot, &me));

        CloseHandle(snapshot);
        return loaded;
    }
};

enum class ModuleWaitResult
{
    Loaded,
    VerificationDenied,
    TimedOut
};