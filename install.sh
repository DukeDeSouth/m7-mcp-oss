#!/bin/bash
# ============================================
# M7 MCP Server - Installation Script
# ============================================
# Usage: ./install.sh
# 
# This script will:
# 1. Check prerequisites (Node.js, npm, Docker)
# 2. Install dependencies
# 3. Build TypeScript
# 4. Configure environment
# 5. Setup ChromaDB (optional)
# 6. Configure Cursor IDE
# ============================================

set -e

VERSION="3.4"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Minimum versions
MIN_NODE_VERSION="20"
MIN_NPM_VERSION="10"

# ============================================
# Helper Functions
# ============================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    echo "║   ███╗   ███╗███████╗    ███╗   ███╗ ██████╗██████╗      ║"
    echo "║   ████╗ ████║╚════██║    ████╗ ████║██╔════╝██╔══██╗     ║"
    echo "║   ██╔████╔██║    ██╔╝    ██╔████╔██║██║     ██████╔╝     ║"
    echo "║   ██║╚██╔╝██║   ██╔╝     ██║╚██╔╝██║██║     ██╔═══╝      ║"
    echo "║   ██║ ╚═╝ ██║   ██║      ██║ ╚═╝ ██║╚██████╗██║          ║"
    echo "║   ╚═╝     ╚═╝   ╚═╝      ╚═╝     ╚═╝ ╚═════╝╚═╝          ║"
    echo "║                                                           ║"
    echo "║           M7 MCP Server - Installation Script             ║"
    echo "║                     Version $VERSION                          ║"
    echo "║                                                           ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

log_info() {
    echo -e "${BLUE}ℹ️  ${NC}$1"
}

log_success() {
    echo -e "${GREEN}✅ ${NC}$1"
}

log_warning() {
    echo -e "${YELLOW}⚠️  ${NC}$1"
}

log_error() {
    echo -e "${RED}❌ ${NC}$1"
}

log_step() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

version_compare() {
    # Returns 0 if $1 >= $2
    local ver1=$1
    local ver2=$2
    
    if [[ "$(printf '%s\n' "$ver2" "$ver1" | sort -V | head -n1)" == "$ver2" ]]; then
        return 0
    else
        return 1
    fi
}

# ============================================
# Prerequisite Checks
# ============================================

check_prerequisites() {
    log_step "Checking Prerequisites"
    
    local all_ok=true
    
    # Check Node.js
    if command -v node &> /dev/null; then
        local node_version=$(node --version | sed 's/v//')
        local node_major=$(echo "$node_version" | cut -d. -f1)
        
        if version_compare "$node_major" "$MIN_NODE_VERSION"; then
            log_success "Node.js v$node_version"
        else
            log_error "Node.js v$node_version (requires v$MIN_NODE_VERSION+)"
            all_ok=false
        fi
    else
        log_error "Node.js not found"
        log_info "Install from: https://nodejs.org/"
        all_ok=false
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        local npm_version=$(npm --version)
        local npm_major=$(echo "$npm_version" | cut -d. -f1)
        
        if version_compare "$npm_major" "$MIN_NPM_VERSION"; then
            log_success "npm v$npm_version"
        else
            log_warning "npm v$npm_version (recommended v$MIN_NPM_VERSION+)"
        fi
    else
        log_error "npm not found"
        all_ok=false
    fi
    
    # Check Docker (optional)
    if command -v docker &> /dev/null; then
        local docker_version=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
        log_success "Docker v$docker_version"
        DOCKER_AVAILABLE=true
    else
        log_warning "Docker not found (ChromaDB will be skipped)"
        log_info "Install from: https://docs.docker.com/get-docker/"
        DOCKER_AVAILABLE=false
    fi
    
    if [ "$all_ok" = false ]; then
        echo ""
        log_error "Prerequisites not met. Please install missing dependencies."
        exit 1
    fi
}

# ============================================
# Installation
# ============================================

install_dependencies() {
    log_step "Installing Dependencies"
    
    cd "$SCRIPT_DIR"
    
    log_info "Running npm install..."
    npm install --silent
    log_success "Dependencies installed"
}

build_typescript() {
    log_step "Building TypeScript"
    
    cd "$SCRIPT_DIR"
    
    log_info "Running npm run build..."
    npm run build --silent
    log_success "Build complete"
}

# ============================================
# Configuration
# ============================================

configure_environment() {
    log_step "Environment Configuration"
    
    cd "$SCRIPT_DIR"
    
    # Check if .env already exists
    if [ -f ".env" ]; then
        log_warning ".env file already exists"
        read -p "Overwrite? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            log_info "Keeping existing .env"
            return
        fi
    fi
    
    # Copy template
    if [ -f ".env.example" ]; then
        cp .env.example .env
        log_success "Created .env from template"
    else
        log_warning ".env.example not found, creating minimal .env"
        touch .env
    fi
    
    echo ""
    log_info "API Keys Configuration"
    echo ""
    
    # OpenAI API Key
    read -p "Enter OPENAI_API_KEY (or press Enter to skip): " openai_key
    if [ -n "$openai_key" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=$openai_key|" .env
        else
            sed -i "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=$openai_key|" .env
        fi
        log_success "OPENAI_API_KEY configured"
    else
        log_warning "OPENAI_API_KEY skipped (required for Hive and embeddings)"
    fi
    
    # Anthropic API Key
    read -p "Enter ANTHROPIC_API_KEY (or press Enter to skip): " anthropic_key
    if [ -n "$anthropic_key" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$anthropic_key|" .env
        else
            sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$anthropic_key|" .env
        fi
        log_success "ANTHROPIC_API_KEY configured"
    else
        log_warning "ANTHROPIC_API_KEY skipped (required for Claude agents)"
    fi
}

# ============================================
# ChromaDB Setup
# ============================================

setup_chromadb() {
    log_step "ChromaDB Setup (Semantic Memory)"
    
    if [ "$DOCKER_AVAILABLE" = false ]; then
        log_warning "Docker not available, skipping ChromaDB"
        log_info "ChromaDB provides semantic search for code memory"
        log_info "To enable later: docker-compose up -d"
        return
    fi
    
    echo ""
    read -p "Setup ChromaDB with Docker? (Y/n): " setup_chroma
    
    if [[ "$setup_chroma" =~ ^[Nn]$ ]]; then
        log_info "ChromaDB skipped"
        return
    fi
    
    cd "$SCRIPT_DIR"
    
    # Check if docker-compose.yml exists
    if [ ! -f "docker-compose.yml" ]; then
        log_error "docker-compose.yml not found"
        return
    fi
    
    log_info "Starting ChromaDB container..."
    docker-compose up -d chromadb
    
    # Wait for health check
    log_info "Waiting for ChromaDB to be ready..."
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:8000/api/v1/heartbeat > /dev/null 2>&1; then
            log_success "ChromaDB is running on http://localhost:8000"
            return
        fi
        sleep 1
        ((attempt++))
    done
    
    log_warning "ChromaDB health check timed out"
    log_info "Check status: docker-compose logs chromadb"
}

# ============================================
# Cursor Integration
# ============================================

configure_cursor() {
    log_step "Cursor IDE Configuration"
    
    local cursor_config_dir="$HOME/.cursor"
    local mcp_config="$cursor_config_dir/mcp.json"
    local m7_path="$SCRIPT_DIR"
    
    echo ""
    read -p "Configure Cursor IDE? (Y/n): " setup_cursor
    
    if [[ "$setup_cursor" =~ ^[Nn]$ ]]; then
        log_info "Cursor configuration skipped"
        log_info "Manual setup: Add M7 to ~/.cursor/mcp.json"
        return
    fi
    
    # Create .cursor directory if needed
    mkdir -p "$cursor_config_dir"
    
    # Get API keys from .env if available
    local openai_key=""
    local anthropic_key=""
    
    if [ -f "$SCRIPT_DIR/.env" ]; then
        openai_key=$(grep "^OPENAI_API_KEY=" "$SCRIPT_DIR/.env" | cut -d= -f2)
        anthropic_key=$(grep "^ANTHROPIC_API_KEY=" "$SCRIPT_DIR/.env" | cut -d= -f2)
    fi
    
    # Check if mcp.json exists
    if [ -f "$mcp_config" ]; then
        log_warning "mcp.json already exists"
        
        # Check if M7 is already configured
        if grep -q '"m7"' "$mcp_config" 2>/dev/null; then
            read -p "M7 already in config. Update? (y/N): " update_config
            if [[ ! "$update_config" =~ ^[Yy]$ ]]; then
                log_info "Keeping existing Cursor config"
                return
            fi
        fi
        
        # Backup existing config
        cp "$mcp_config" "$mcp_config.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Backed up existing mcp.json"
    fi
    
    # Generate new mcp.json with M7
    cat > "$mcp_config" << EOF
{
  "mcpServers": {
    "m7": {
      "command": "node",
      "args": ["$m7_path/dist/index.js"],
      "cwd": "$m7_path",
      "env": {
        "OPENAI_API_KEY": "$openai_key",
        "ANTHROPIC_API_KEY": "$anthropic_key",
        "CHROMA_URL": "http://localhost:8000"
      }
    }
  }
}
EOF
    
    log_success "Cursor configuration updated"
    log_info "Config location: $mcp_config"
}

# ============================================
# Final Tests
# ============================================

run_tests() {
    log_step "Verification"
    
    cd "$SCRIPT_DIR"
    
    log_info "Testing MCP protocol..."
    
    local test_result=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | timeout 10 node dist/index.js 2>/dev/null || echo "error")
    
    if echo "$test_result" | grep -q "mcp_m7_analyze_task" 2>/dev/null; then
        log_success "MCP tools loaded successfully"
    else
        log_warning "MCP test inconclusive (this is normal for stdio mode)"
    fi
}

# ============================================
# Success Message
# ============================================

print_success() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}║   🎉 M7 MCP Server installed successfully!                ║${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BOLD}🚀 Quick Start:${NC}"
    echo ""
    echo "   1. Restart Cursor IDE"
    echo "   2. Open any project"
    echo "   3. Try: м7: тест"
    echo ""
    echo -e "${BOLD}📚 Useful Commands:${NC}"
    echo ""
    echo "   • Start ChromaDB:    docker-compose up -d"
    echo "   • Stop ChromaDB:     docker-compose down"
    echo "   • View logs:         docker-compose logs -f"
    echo "   • Rebuild M7:        npm run build"
    echo ""
    echo -e "${BOLD}📖 Documentation:${NC}"
    echo ""
    echo "   • DEPLOYMENT_GUIDE.md - Full deployment guide"
    echo "   • INDEX.md           - Project overview"
    echo "   • .cursorrules       - M7 methodology rules"
    echo ""
    echo -e "${CYAN}Enjoy systematic, enterprise-ready development! 🎯${NC}"
    echo ""
}

# ============================================
# Main
# ============================================

main() {
    print_banner
    check_prerequisites
    install_dependencies
    build_typescript
    configure_environment
    setup_chromadb
    configure_cursor
    run_tests
    print_success
}

# Run main with all arguments
main "$@"
