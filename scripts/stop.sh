#!/bin/bash

# ZK Certificate System - Stop Script
# This script stops all running services

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "Stopping ZK Certificate System services..."

# Read saved process IDs
if [ -f ".process_ids" ]; then
    source .process_ids
    
    if [ ! -z "$HARDHAT_PID" ] && kill -0 $HARDHAT_PID 2>/dev/null; then
        kill $HARDHAT_PID
        print_success "Hardhat node stopped (PID: $HARDHAT_PID)"
    fi
    
    if [ ! -z "$BACKEND_PID" ] && kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID  
        print_success "Backend services stopped (PID: $BACKEND_PID)"
    fi
    
    if [ ! -z "$FRONTEND_PID" ] && kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID
        print_success "Frontend services stopped (PID: $FRONTEND_PID)"
    fi
    
    rm .process_ids
else
    print_warning "No process IDs file found. Attempting to find and stop services..."
    
    # Try to stop processes by port/name
    pkill -f "hardhat node" && print_success "Hardhat node stopped"
    pkill -f "npm.*backend" && print_success "Backend services stopped"  
    pkill -f "npm.*frontend" && print_success "Frontend services stopped"
    pkill -f "next-server" && print_success "Next.js server stopped"
fi

# Kill any remaining processes on our ports
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null && print_success "Port 3000 freed"
lsof -ti:3001 2>/dev/null | xargs kill -9 2>/dev/null && print_success "Port 3001 freed" 
lsof -ti:8545 2>/dev/null | xargs kill -9 2>/dev/null && print_success "Port 8545 freed"

print_success "All ZK Certificate System services stopped! 🏁"