#!/bin/bash

# Writes public/config.json (served as /config.json) from AWS SSM, ready for `vite build`.
# Usage: set-config.sh [sandbox|prod|localhost]
#
# SSM parameters read (in the environment's AWS account, eu-west-2):
#   /purr/{env}/cognito/client-id
#   /purr/{env}/cognito/user-pool-id
#   /purr/{env}/cognito/login-domain
#   /purr/{env}/web/domain
# "localhost" reads the sandbox parameters but points the redirects at http://localhost:3000.

set -euo pipefail

ENV="${1:-sandbox}"

case $ENV in
  prod | sandbox) AWS_ENV=$ENV ;;
  localhost) AWS_ENV=sandbox ;;
  *)
    echo "Unknown environment: $ENV" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../public/config.json"
TEMPLATE="$SCRIPT_DIR/../src/config/config.json.template"

# Only set AWS_PROFILE when no credential env vars are present (local dev). In CI,
# configure-aws-credentials sets AWS_ACCESS_KEY_ID directly.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_PROFILE="${AWS_PROFILE:-nakom.is-$AWS_ENV}"
fi
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-eu-west-2}}"

ssm() {
  aws ssm get-parameter --name "/purr/${AWS_ENV}/$1" --query "Parameter.Value" --output text
}

mkdir -p "$(dirname "$CONFIG_FILE")"
cp "$TEMPLATE" "$CONFIG_FILE"

setValue() {
  local key="$1" value="$2" tmp
  echo "Setting $key to $value"
  tmp=$(mktemp)
  sed "s|\"$key\": \".*\"|\"$key\": \"$value\"|g" "$CONFIG_FILE" >"$tmp" && mv "$tmp" "$CONFIG_FILE"
}

USER_POOL_ID=$(ssm cognito/user-pool-id)
setValue authority "https://cognito-idp.${AWS_DEFAULT_REGION}.amazonaws.com/${USER_POOL_ID}"
setValue clientId "$(ssm cognito/client-id)"
setValue cognitoDomain "$(ssm cognito/login-domain)"

if [[ $ENV == "localhost" ]]; then
  ORIGIN="http://localhost:3000"
else
  ORIGIN="https://$(ssm web/domain)"
fi
setValue redirectUri "$ORIGIN/loggedin"
setValue logoutUri "$ORIGIN/logout"
