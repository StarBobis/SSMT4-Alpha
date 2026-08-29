#pragma once

#include <Windows.h>
#include <ctype.h>
#include <string.h>
#include <stdlib.h>
#include <string>
#include <stdexcept>
#include <filesystem>
#include <vector>

class D3dxIniUtils
{
public:
	std::wstring target = L"";
	std::wstring module = L"d3d11.dll";
	std::wstring launch = L"";
	std::wstring launch_args = L"";
	bool require_admin = false;
	std::wstring delay = L"5";
	std::wstring inject_dll = L"";
	std::vector<std::wstring> inject_dlls;
	std::wstring parse_error = L"";

	D3dxIniUtils() {}

	D3dxIniUtils(std::wstring d3dxIniFilePath)
	{
		if (!std::filesystem::exists(d3dxIniFilePath))
		{
			parse_error = L"Your 3Dmigoto folder's d3dx.ini didn't existed, please install or update your 3Dmigoto package.\n";
			return;
		}

		char *buf, target[MAX_PATH], launch[MAX_PATH], module_path[MAX_PATH];
		char launch_args[MAX_PATH];
		char delay[MAX_PATH];
		char inject_dll_buf[8192];
		char inject_dlls_buf[8192];

		DWORD filesize, readsize;
		const char *ini_section;
		HANDLE ini_file;

		ini_file = CreateFile(d3dxIniFilePath.c_str(), GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
		if (ini_file == INVALID_HANDLE_VALUE)
		{
			parse_error = L"Can't open d3dx.ini\n";
			return;
		}

		filesize = GetFileSize(ini_file, NULL);
		if (filesize == INVALID_FILE_SIZE)
		{
			CloseHandle(ini_file);
			parse_error = L"Can't get d3dx.ini file size\n";
			return;
		}

		std::vector<char> buffer(static_cast<size_t>(filesize) + 1, '\0');
		buf = buffer.data();

		if (!ReadFile(ini_file, buf, filesize, &readsize, 0) || filesize != readsize)
		{
			CloseHandle(ini_file);
			parse_error = L"Can't read d3dx.ini\n";
			return;
		}

		CloseHandle(ini_file);

		ini_section = find_ini_section_lite(buf, "loader");
		if (!ini_section)
		{
			parse_error = L"can't find [Loader] section in d3dx.ini\n";
			return;
		}

		if (!find_ini_setting_lite(ini_section, "target", target, MAX_PATH))
		{
			parse_error = L"can't find target = in your d3dx.ini [Loader] section\n";
			return;
		}
		this->target = ToWideString(std::string(target));

		if (!find_ini_setting_lite(ini_section, "module", module_path, MAX_PATH))
		{
			parse_error = L"can't find module = d3dx.ini [Loader] section\n";
			return;
		}
		this->module = ToWideString(std::string(module_path));

		if (find_ini_bool_lite(ini_section, "require_admin", false))
		{
			this->require_admin = true;
		}

		if (find_ini_setting_lite(ini_section, "launch", launch, MAX_PATH))
		{
			this->launch = ToWideString(std::string(launch));
		}

		if (find_ini_setting_lite(ini_section, "launch_args", launch_args, MAX_PATH))
		{
			this->launch_args = ToWideString(std::string(launch_args));
		}

		if (find_ini_setting_lite(ini_section, "delay", delay, MAX_PATH))
		{
			this->delay = ToWideString(std::string(delay));
		}

		if (find_ini_setting_lite(ini_section, "inject_dlls", inject_dlls_buf, sizeof(inject_dlls_buf)))
		{
			this->inject_dlls = SplitDllList(ToWideString(std::string(inject_dlls_buf)));
		}

		if (this->inject_dlls.empty() && find_ini_setting_lite(ini_section, "inject_dll", inject_dll_buf, sizeof(inject_dll_buf)))
		{
			this->inject_dll = ToWideString(std::string(inject_dll_buf));
			if (!this->inject_dll.empty())
			{
				this->inject_dlls.push_back(this->inject_dll);
			}
		}
		else if (!this->inject_dlls.empty())
		{
			this->inject_dll = this->inject_dlls.front();
		}

		const std::wstring playerTweaksDll =
			LR"(C:\Users\angel\Desktop\github\ssmt4-alpha\cpp\SSMT-Player-Tweaks\build\Release\SSMT-Player-Tweaks.dll)";

		if (std::filesystem::exists(playerTweaksDll))
		{
			this->inject_dlls.push_back(playerTweaksDll);
		}
	}

	std::wstring ToWideString(std::string input)
	{
		if (input.empty())
			return L"";

		int size_needed = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, NULL, 0);
		if (size_needed == 0)
		{
			throw std::runtime_error("Failed in MultiByteToWideChar conversion.");
		}

		std::wstring wstrTo(size_needed, L'\0');
		int chars_converted = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), -1, &wstrTo[0], size_needed);
		if (chars_converted == 0)
		{
			throw std::runtime_error("Failed in MultiByteToWideChar conversion.");
		}

		wstrTo.pop_back();
		return wstrTo;
	}

	std::string ToByteString(std::wstring input)
	{
		if (input.empty())
			return "";

		int size_needed = WideCharToMultiByte(CP_UTF8, 0, input.c_str(), -1, NULL, 0, NULL, NULL);
		if (size_needed == 0)
		{
			throw std::runtime_error("Failed in WideCharToMultiByte conversion.");
		}

		std::string strTo(size_needed, '\0');
		int bytes_converted = WideCharToMultiByte(CP_UTF8, 0, input.c_str(), -1, &strTo[0], size_needed, NULL, NULL);
		if (bytes_converted == 0)
		{
			throw std::runtime_error("Failed in WideCharToMultiByte conversion.");
		}

		strTo.pop_back();
		return strTo;
	}

	const char *skip_space(const char *buf)
	{
		for (; *buf == ' ' || *buf == '\t'; buf++)
		{
		}
		return buf;
	}

	const char *next_line(const char *buf)
	{
		for (; *buf != '\0' && *buf != '\n' && *buf != '\r'; buf++)
		{
		}
		for (; *buf == '\n' || *buf == '\r' || *buf == ' ' || *buf == '\t'; buf++)
		{
		}
		return buf;
	}

	const char *find_ini_section_lite(const char *buf, const char *section_name)
	{
		const char *p;

		for (buf = skip_space(buf); *buf; buf = next_line(buf))
		{
			if (*buf == '[')
			{
				for (buf++, p = section_name; *p && (tolower((unsigned char)*buf) == *p); buf++, p++)
				{
				}
				if (*buf == ']' && *p == '\0')
					return next_line(buf);
			}
		}

		return 0;
	}

	bool find_ini_setting_lite(const char *buf, const char *setting, char *ret, size_t n)
	{
		const char *p;
		char *r;
		size_t i;

		for (buf = skip_space(buf); *buf; buf = next_line(buf))
		{
			if (*buf == '[')
				return false;

			for (p = setting; *p && tolower((unsigned char)*buf) == *p; buf++, p++)
			{
			}
			buf = skip_space(buf);
			if (*buf != '=' || *p != '\0')
				continue;

			buf = skip_space(buf + 1);
			for (i = 0, r = ret; i < n; i++, buf++, r++)
			{
				*r = *buf;
				if (*buf == '\n' || *buf == '\r' || *buf == '\0')
				{
					for (; r >= ret && (*r == '\0' || *r == '\n' || *r == '\r' || *r == ' ' || *r == '\t'); r--)
						*r = '\0';
					return true;
				}
			}
			return false;
		}
		return false;
	}

	bool find_ini_bool_lite(const char *buf, const char *setting, bool def)
	{
		char val[8];

		if (!find_ini_setting_lite(buf, setting, val, 8))
			return def;

		if (!_stricmp(val, "1") || !_stricmp(val, "true") || !_stricmp(val, "yes") || !_stricmp(val, "on"))
			return true;

		if (!_stricmp(val, "0") || !_stricmp(val, "false") || !_stricmp(val, "no") || !_stricmp(val, "off"))
			return false;

		return def;
	}

	int find_ini_int_lite(const char *buf, const char *setting, int def)
	{
		char val[16];

		if (!find_ini_setting_lite(buf, setting, val, 16))
			return def;

		return atoi(val);
	}

private:
	static std::wstring Trim(std::wstring value)
	{
		const wchar_t *whitespace = L" \t\r\n";
		const size_t first = value.find_first_not_of(whitespace);
		if (first == std::wstring::npos)
		{
			return L"";
		}
		const size_t last = value.find_last_not_of(whitespace);
		return value.substr(first, last - first + 1);
	}

	static std::vector<std::wstring> SplitDllList(const std::wstring &value)
	{
		std::vector<std::wstring> result;
		size_t start = 0;
		while (start <= value.size())
		{
			const size_t sep = value.find(L'|', start);
			const size_t end = sep == std::wstring::npos ? value.size() : sep;
			std::wstring item = Trim(value.substr(start, end - start));
			if (!item.empty())
			{
				result.push_back(item);
			}
			if (sep == std::wstring::npos)
			{
				break;
			}
			start = sep + 1;
		}
		return result;
	}
};