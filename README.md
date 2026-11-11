# Cattle Virtual Fence

Experimental computer-vision-based livestock monitoring and virtual-fencing project.

## Repository layout

- `backend/`: Python backend and computer-vision dependencies (see `requirements.txt`).
- `mobile/`: Expo / React Native mobile application.
- `docker-compose.yml`: local service orchestration configuration.

## Development setup

### Backend

Create a Python virtual environment, then install the backend requirements:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Review backend entry points and required configuration before starting services. The requirements currently contain unpinned dependencies; reproducible installation and supported Python versions need verification.

### Mobile

```bash
cd mobile
npm ci
npx expo start
```

Expo native features may require device permissions and additional configuration.

## Verification and limitations

This is a prototype, not a validated animal-containment or safety system. No real-world containment performance or detection accuracy is claimed here. Hardware, model files, video sources and network configuration must be verified for each deployment.

## Security

Do not commit credentials, camera access tokens, recordings containing private information or environment-specific configuration. Use authorized devices and networks only.

## Next steps

- Document backend startup and API endpoints from verified source.
- Add architecture diagram and screenshots.
- Pin and audit Python dependencies.
- Add tests and document detection accuracy and limitations.
