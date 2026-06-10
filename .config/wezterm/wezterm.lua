local wezterm = require 'wezterm'
local config = wezterm.config_builder()

-- Font
config.font = wezterm.font('Fira Code', { weight = 'Regular' })
config.font_size = 13.0
config.line_height = 1.2

-- Color scheme
config.color_scheme = 'Solarized Dark (Gogh)'

-- Window appearance: borderless / minimal
config.window_decorations = 'RESIZE'

-- Background transparency & blur (macOS)
config.window_background_opacity = 0.8
config.macos_window_background_blur = 5

-- Padding inside the window
config.window_padding = {
  left   = 10,
  right  = 10,
  top    = 10,
  bottom = 10,
}

-- Tab bar: hide when only one tab (cleaner look)
config.hide_tab_bar_if_only_one_tab = true
config.use_fancy_tab_bar = false

-- Cursor
config.default_cursor_style = 'BlinkingBar'

-- Scrollback
config.scrollback_lines = 10000

-- Close confirmation
config.window_close_confirmation = 'NeverPrompt'

-- Bell
config.audible_bell = 'Disabled'

-- GPU rendering
config.front_end = 'WebGpu'

return config
