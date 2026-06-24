#!/usr/bin/env bash
#
# Bootstrap a new machine. Safe to re-run; every step skips itself if done.
#
# On a fresh machine:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/bagelbits/dotfiles/main/install.sh)"

set -euo pipefail

CHEZMOI_DIR="$HOME/.local/share/chezmoi"
ZINIT_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/zinit/zinit.git"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }

# --- Homebrew ---------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  info "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  info "Homebrew already installed"
fi

# brew isn't on PATH yet in a fresh shell
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

# --- chezmoi + dotfiles -----------------------------------------------------
if ! command -v chezmoi >/dev/null 2>&1; then
  info "Installing chezmoi"
  brew install chezmoi
fi

if [ -d "$CHEZMOI_DIR/.git" ]; then
  info "Dotfiles repo already cloned; applying"
  chezmoi apply
else
  info "Cloning dotfiles and applying"
  chezmoi init --apply bagelbits
fi

# --- Brewfile ---------------------------------------------------------------
info "Installing Brewfile (CLI tools, apps, fonts, App Store apps)"
if ! brew bundle --file "$CHEZMOI_DIR/Brewfile"; then
  warn "brew bundle had failures — mas apps (RunCat) need you to be signed into the App Store. Re-run after signing in."
fi

# --- oh-my-zsh --------------------------------------------------------------
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  info "Installing oh-my-zsh (keeping the chezmoi-managed .zshrc)"
  RUNZSH=no CHSH=no KEEP_ZSHRC=yes \
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
else
  info "oh-my-zsh already installed"
fi

# --- zinit ------------------------------------------------------------------
# Cloned directly instead of via the zinit installer so it can't touch .zshrc,
# which already contains the loader. NVM is handled by zinit (zsh-nvm installs
# it lazily on first shell), so there's no nvm step here.
if [ ! -d "$ZINIT_HOME" ]; then
  info "Installing zinit"
  mkdir -p "$(dirname "$ZINIT_HOME")"
  git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
else
  info "zinit already installed"
fi

# --- SSH key ----------------------------------------------------------------
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  info "Generating SSH key"
  default_email="$(git config user.email 2>/dev/null || true)"
  read -rp "Email for SSH key [${default_email}]: " ssh_email
  ssh_email="${ssh_email:-$default_email}"
  ssh-keygen -t ed25519 -C "$ssh_email" -f "$HOME/.ssh/id_ed25519"
  eval "$(ssh-agent -s)" >/dev/null
  ssh-add --apple-use-keychain "$HOME/.ssh/id_ed25519"
  pbcopy <"$HOME/.ssh/id_ed25519.pub"
  info "Public key copied to clipboard — add it at https://github.com/settings/ssh/new"
else
  info "SSH key already exists"
fi

# --- RVM --------------------------------------------------------------------
if [ ! -d "$HOME/.rvm" ]; then
  info "Installing RVM"
  # Import keys straight from rvm.io; keyservers are flaky (see rvm.io/rvm/security)
  curl -sSL https://rvm.io/mpapis.asc | gpg --import -
  curl -sSL https://rvm.io/pkuczynski.asc | gpg --import -
  curl -sSL https://get.rvm.io | bash -s stable || warn "RVM install failed — see https://rvm.io/rvm/install"
else
  info "RVM already installed"
fi

# --- peon-ping --------------------------------------------------------------
if command -v peon >/dev/null 2>&1; then
  info "Setting peon-ping pack"
  peon packs install dreamy-minimal
  peon packs use dreamy-minimal
fi

# --- Claude Code plugins ----------------------------------------------------
# Local skills live in the dotfiles (~/.claude/skills, ~/.codex/skills) and are
# applied by chezmoi. Plugins come from marketplaces, so they're (re)installed
# here instead. Idempotent: each step skips itself if already present.
if command -v claude >/dev/null 2>&1; then
  info "Installing Claude Code plugins"

  existing_markets="$(claude plugin marketplace list 2>/dev/null || true)"
  if grep -q claude-plugins-official <<<"$existing_markets"; then
    info "  marketplace claude-plugins-official already added"
  else
    info "  adding marketplace claude-plugins-official"
    claude plugin marketplace add anthropics/claude-plugins-official \
      || warn "  failed to add marketplace claude-plugins-official"
  fi

  installed_plugins="$(claude plugin list 2>/dev/null || true)"
  for plugin in \
    superpowers@claude-plugins-official \
    code-simplifier@claude-plugins-official \
    github@claude-plugins-official; do
    if grep -q "$plugin" <<<"$installed_plugins"; then
      info "  $plugin already installed"
    else
      info "  installing $plugin"
      claude plugin install "$plugin" || warn "  failed to install $plugin"
    fi
  done
else
  warn "Claude Code (claude) not found — skipping plugins. Install Claude Code, then re-run."
fi

# --- Done -------------------------------------------------------------------
cat <<'EOF'

Done! A few things still need a human:

  * Sign into the App Store, then re-run this script if RunCat didn't install
  * Add the SSH key (already on your clipboard) to GitHub: https://github.com/settings/ssh/new
  * VSCode: install the 'code' command (Cmd+Shift+P -> "Shell Command") and turn on Settings Sync
  * WezTerm background image: https://i.imgur.com/wimz70n.jpg
  * Run `p10k configure` if the prompt looks off
  * Open a new terminal so zinit installs its plugins (zsh-nvm installs nvm on first load)
EOF
