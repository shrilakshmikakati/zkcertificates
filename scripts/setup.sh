#!/bin/bash

# ZK Certificate System - Setup Script
# This script automates the entire deployment process for local development

set -e  # Exit on any error

echo " ZK Certificate System Setup Starting..."
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
print_status "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    print_error "Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm not found. Please install npm first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18+ required. Current version: $(node -v)"
    exit 1
fi

print_success "Prerequisites check passed"

# Install root dependencies
print_status "Installing root dependencies..."
npm install || {
    print_error "Failed to install root dependencies"
    exit 1
}
print_success "Root dependencies installed"

# Install backend dependencies
print_status "Installing backend dependencies..."
cd backend && npm install && cd .. || {
    print_error "Failed to install backend dependencies"
    exit 1
}
print_success "Backend dependencies installed"

# Install frontend dependencies  
print_status "Installing frontend dependencies..."
cd frontend && npm install && cd .. || {
    print_error "Failed to install frontend dependencies"
    exit 1
}
print_success "Frontend dependencies installed"

# Setup environment files
print_status "Setting up environment configuration..."

if [ ! -f "backend/.env" ]; then
    cp backend/.env.example backend/.env
    print_success "Backend .env file created from template"
else
    print_warning "Backend .env file already exists, skipping..."
fi

# Create directories if they don't exist
mkdir -p deployments
mkdir -p backend/uploads
mkdir -p circuits/keys
mkdir -p backend/src/templates

print_success "Directory structure created"

# Generate CSV template
print_status "Generating CSV template..."
cat > backend/src/templates/certificate_template.csv << EOF
studentId,studentName,email,subject1,subject2,subject3,subject4,subject5
STU001,Alice Johnson,alice.johnson@university.edu,88,92,85,90,87
STU002,Bob Smith,bob.smith@university.edu,76,84,79,82,88
STU003,Carol Davis,carol.davis@university.edu,94,89,91,95,92
STU004,David Wilson,david.wilson@university.edu,82,87,84,89,86
STU005,Emma Brown,emma.brown@university.edu,91,88,93,87,90
EOF
print_success "CSV template generated"

# Compile smart contracts
print_status "Compiling smart contracts..."
npm run compile || {
    print_error "Failed to compile smart contracts"
    exit 1
}
print_success "Smart contracts compiled"

# Start deployment process
print_status "Starting deployment process..."

# Check if Hardhat network is running
if ! curl -s http://127.0.0.1:8545 > /dev/null; then
    print_warning "Local blockchain not detected. Starting Hardhat node..."
    npm run node &
    HARDHAT_PID=$!
    sleep 5
    
    if curl -s http://127.0.0.1:8545 > /dev/null; then
        print_success "Hardhat node started successfully"
    else
        print_error "Failed to start Hardhat node"
        exit 1
    fi
else
    print_success "Local blockchain detected and running"
fi

# Deploy contracts
print_status "Deploying smart contracts..."
sleep 2  # Give network time to stabilize
npm run deploy || {
    print_error "Failed to deploy smart contracts"
    if [ ! -z "$HARDHAT_PID" ]; then
        kill $HARDHAT_PID
    fi
    exit 1
}
print_success "Smart contracts deployed successfully"

# Start backend in background
print_status "Starting backend services..."
cd backend
npm start &
BACKEND_PID=$!
cd ..
sleep 3

# Check if backend is running
if curl -s http://localhost:3001/health > /dev/null; then
    print_success "Backend services started successfully"
else
    print_warning "Backend health check failed, but continuing..."
fi

# Start frontend in background  
print_status "Starting frontend services..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..
sleep 5

# Check if frontend is running
if curl -s http://localhost:3000 > /dev/null; then
    print_success "Frontend services started successfully"
else
    print_warning "Frontend health check failed, but continuing..."
fi

# Display deployment summary
echo ""
echo " ZK Certificate System Setup Complete!"
echo "========================================"
echo ""
echo "Access Points:"
echo "   Frontend:    http://localhost:3000"
echo "   Backend API: http://localhost:3001"  
echo "   Blockchain:  http://127.0.0.1:8545"
echo ""

if [ -f "deployments/latest.json" ]; then
    echo " Deployed Contracts:"
    cat deployments/latest.json | grep -E '"address"' | sed 's/.*": "//g' | sed 's/".*//g' | while read addr; do
        echo "   Contract: $addr"
    done
    echo ""
fi

echo " Next Steps:"
echo "   1. Visit http://localhost:3000 to access the application"
echo "   2. Try issuing certificates with the sample CSV template" 
echo "   3. Test certificate verification and ZK proof generation"
echo "   4. Check the documentation at /docs for detailed usage"
echo ""

echo "  Development Commands:"
echo "   npm run compile      # Compile smart contracts"
echo "   npm run test         # Run tests"
echo "   npm run dev:backend  # Restart backend only"
echo "   npm run dev:frontend # Restart frontend only"
echo ""

echo " Process IDs (for manual stop):"
[ ! -z "$HARDHAT_PID" ] && echo "   Hardhat Node: $HARDHAT_PID"
[ ! -z "$BACKEND_PID" ] && echo "   Backend: $BACKEND_PID"  
[ ! -z "$FRONTEND_PID" ] && echo "   Frontend: $FRONTEND_PID"
echo ""

# Save PIDs for cleanup script
cat > .process_ids << EOF
HARDHAT_PID=$HARDHAT_PID
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
EOF

echo " To stop all services, run: ./scripts/stop.sh"
echo ""
print_success "Setup completed successfully! "