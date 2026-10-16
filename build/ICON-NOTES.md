# 应用图标

生成方式：内置 image_gen 工具。仅用于应用图标，侧栏“贴”字标志保持原样。

资源：icon.png（1024×1024，透明外边缘）、icon.ico（16/24/32/48/64/128/256）、icon.icns（macOS 多分辨率）。

重新转换：`python3 scripts/build-icons.py build/icon.png`，需要 Pillow。

最终生成提示词：

> Use case: logo-brand. Asset type: production desktop application icon for a Chinese Tieba Cookie account manager. Create ONE square 1024x1024 polished app icon. A rich cobalt blue rounded-square tile occupying 84% of canvas, centered, with optically balanced large bold white Chinese character exactly “贴” as the main symbol. Subtle lighter blue edge lighting and a small layered browser-tab motif behind the character, minimal and professional, clear at 32px, restrained soft depth, crisp edges, no tiny details. Transparent outer corners and margins, no background scene, no device mockup, no caption, no letters, no other text, no watermark. The character must be legible and accurately written. Palette matches #3865ef with white. Actual alpha outside the tile.

打包配置使用平台图标，运行时 PNG 通过 extraResources 打包；开发时从 build/icon.png 读取。Mac 开发启动时通过 app.dock.setIcon 设置程序坞图标。桌面和已安装应用的图标需重新打包安装后更新。
