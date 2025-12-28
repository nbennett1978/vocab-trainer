#!/bin/bash

# Docker Hub repository
REPO="nbennett1978/vocab-trainer"

# Version file to track current version
VERSION_FILE=".version"

# Get current version
if [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION=$(cat "$VERSION_FILE")
else
    CURRENT_VERSION="v1.1.0"
fi

# Parse version numbers (remove 'v' prefix)
VERSION_NUM=${CURRENT_VERSION#v}
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION_NUM"

# Calculate next patch version
NEXT_PATCH=$((PATCH + 1))
DEFAULT_VERSION="v${MAJOR}.${MINOR}.${NEXT_PATCH}"

# Ask for version
echo "Current version: $CURRENT_VERSION"
read -p "Enter new version [$DEFAULT_VERSION]: " INPUT_VERSION

# Use default if empty
VERSION=${INPUT_VERSION:-$DEFAULT_VERSION}

# Validate version format
if [[ ! $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format vX.Y.Z (e.g., v1.2.3)"
    exit 1
fi

echo ""
echo "Building and pushing version: $VERSION"
echo "================================"

# Build Docker image
echo "Building Docker image..."
docker build -t "${REPO}:${VERSION}" . || { echo "Build failed!"; exit 1; }

# Tag as latest
echo "Tagging as latest..."
docker tag "${REPO}:${VERSION}" "${REPO}:latest"

# Push to Docker Hub
echo "Pushing ${VERSION}..."
docker push "${REPO}:${VERSION}" || { echo "Push failed!"; exit 1; }

echo "Pushing latest..."
docker push "${REPO}:latest" || { echo "Push failed!"; exit 1; }

# Save new version
echo "$VERSION" > "$VERSION_FILE"

echo ""
echo "================================"
echo "Successfully released $VERSION"
echo "  - ${REPO}:${VERSION}"
echo "  - ${REPO}:latest"
echo ""
echo "Don't forget to create a GitHub release for $VERSION"
