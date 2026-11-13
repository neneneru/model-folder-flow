"""Local Windows-only reveal for files registered by ReForge Extra Networks."""
import os
import json
import asyncio
import sys
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from modules import script_callbacks, shared, ui_extra_networks

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
KINDS = {"lora", "textual_inversion", "checkpoints"}


def available(request):
    return (sys.platform == "win32"
            and not getattr(shared.cmd_opts, "hide_ui_dir_config", False)
            and request.client is not None and request.client.host in LOOPBACK
            and request.url.hostname in LOOPBACK)


def require_local(request):
    if not available(request):
        raise HTTPException(403, "Local Windows access required")
    origin = urlsplit(request.headers.get("origin", ""))
    if (origin.scheme, origin.netloc) != (request.url.scheme, request.url.netloc):
        raise HTTPException(403, "Same-origin access required")
    if request.headers.get("x-model-folder-flow") != "1":
        raise HTTPException(403, "Invalid request")


def registered_file(kind, requested):
    if not isinstance(kind, str) or kind not in KINDS or not isinstance(requested, str) or len(requested) > 32768:
        raise HTTPException(400, "Invalid model")
    # Do not execute arbitrary browser-provided paths. Resolve only trusted items.
    wanted = os.path.normcase(os.path.normpath(requested))
    for page in ui_extra_networks.extra_pages:
        if page.name.lower().replace(" ", "_") != kind:
            continue
        for item in page.items.values():
            filename = item.get("filename")
            if filename and os.path.normcase(os.path.normpath(filename)) == wanted:
                path = Path(filename)
                if path.is_file():
                    resolved = path.resolve()
                    if not str(resolved).startswith(("\\\\", "//")):
                        return resolved
    raise HTTPException(404, "Model is no longer available; refresh the model list")


# Official ShellFolderView.SelectItem flags: select | deselect others |
# ensure visible | focus. No key presses or coordinate-based automation.
# https://learn.microsoft.com/windows/win32/shell/shellfolderview-selectitem
REVEAL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$target = [string]([Console]::In.ReadToEnd() | ConvertFrom-Json)
$directory = [IO.Path]::GetDirectoryName($target)
$leaf = [IO.Path]::GetFileName($target)
$shell = New-Object -ComObject Shell.Application
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $selected = $false
    foreach ($window in @($shell.Windows())) {
        try {
            if ([IO.Path]::GetFileName([string]$window.FullName) -ine 'explorer.exe') { continue }
            $view = $window.Document
            $folder = $view.Folder
            if (-not [string]::Equals([string]$folder.Self.Path, $directory, [StringComparison]::OrdinalIgnoreCase)) { continue }
            $item = $folder.ParseName($leaf)
            if ($null -eq $item -or -not [string]::Equals([string]$item.Path, $target, [StringComparison]::OrdinalIgnoreCase)) { continue }
            $view.SelectItem($item, 29)
            $selected = $true
        } catch { }
    }
    if ($selected) { [Console]::Out.Write('OK'); exit 0 }
    Start-Sleep -Milliseconds 100
}
exit 2
"""


def reveal(path):
    system = Path(os.environ.get("WINDIR", "C:\\Windows"))
    # Preserve the proven native open/select behavior, then explicitly scroll
    # the exact registered item into the view through the Windows Shell API.
    subprocess.Popen([str(system / "explorer.exe"), "/select," + str(path)], shell=False)
    powershell = system / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    result = subprocess.run(
        [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", REVEAL_SCRIPT],
        input=json.dumps(str(path), ensure_ascii=True).encode("ascii"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=8,
    )
    if result.returncode != 0 or result.stdout.strip() != b"OK":
        raise OSError("Explorer selection could not be confirmed")


def on_app_started(_demo, app):
    @app.get("/model-folder-flow/capabilities")
    async def capabilities(request: Request):
        return {"reveal": available(request)}

    @app.post("/model-folder-flow/reveal")
    async def reveal_model(request: Request):
        require_local(request)
        body = await request.body()
        if len(body) > 40000:
            raise HTTPException(400, "Invalid model")
        try:
            import json
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(400, "Invalid request")
        path = registered_file(data.get("kind"), data.get("path"))
        try:
            await asyncio.to_thread(reveal, path)
        except (OSError, subprocess.TimeoutExpired):
            raise HTTPException(500, "Unable to confirm Explorer selection")
        return {"ok": True}


script_callbacks.on_app_started(on_app_started)
