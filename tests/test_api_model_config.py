import pytest
import configparser
import os
import shutil
from fastapi.testclient import TestClient
from api import api as actual_api # Assuming api.py is in the root and exposes 'api'

# client = TestClient(actual_api) # This will be initialized properly later

CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', 'config.ini') # Relative to tests directory
BACKUP_CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', 'config.ini.backup')

# Original provider details to restore if changed by tests
ORIGINAL_PROVIDER_MODEL = "deepseek-r1:14b" # Default from original config.ini

@pytest.fixture(scope="module", autouse=True)
def backup_and_restore_config():
    """
    Module-scoped fixture to backup config.ini before any tests run
    and restore it after all tests in the module have completed.
    """
    if os.path.exists(CONFIG_FILE_PATH):
        shutil.copyfile(CONFIG_FILE_PATH, BACKUP_CONFIG_FILE_PATH)
        print(f"Backed up {CONFIG_FILE_PATH} to {BACKUP_CONFIG_FILE_PATH}")

    yield  # This is where the tests will run

    if os.path.exists(BACKUP_CONFIG_FILE_PATH):
        shutil.copyfile(BACKUP_CONFIG_FILE_PATH, CONFIG_FILE_PATH)
        os.remove(BACKUP_CONFIG_FILE_PATH)
        print(f"Restored {CONFIG_FILE_PATH} from backup and removed backup.")
    elif not os.path.exists(CONFIG_FILE_PATH) and not os.path.exists(BACKUP_CONFIG_FILE_PATH):
        # If config.ini was deleted and no backup exists, create a default one.
        # This case should ideally not happen if backup works.
        print("Config.ini was missing and no backup found. Creating a default one for safety.")
        config = configparser.ConfigParser()
        config['MAIN'] = {
            'is_local': 'True',
            'provider_name': 'ollama',
            'provider_model': ORIGINAL_PROVIDER_MODEL, # Use a known default
            'provider_server_address': '127.0.0.1:11434',
            'agent_name': 'TestAgent',
            'recover_last_session': 'False',
            'save_session': 'False',
            'speak': 'False',
            'listen': 'False',
            'work_dir': '/tmp/agenticseek_test_workdir',
            'jarvis_personality': 'False',
            'languages': 'en'
        }
        config['BROWSER'] = {
            'headless_browser': 'True',
            'stealth_mode': 'False'
        }
        with open(CONFIG_FILE_PATH, 'w') as configfile:
            config.write(configfile)


@pytest.fixture
def test_client(backup_and_restore_config): # Depends on the backup fixture
    """
    Function-scoped fixture to provide a TestClient instance.
    It also ensures config.ini is reset to a known state before each test.
    """
    # Ensure a clean config.ini for each test
    config = configparser.ConfigParser()
    config.read(CONFIG_FILE_PATH) # Read current or restored config

    # Set a known model for testing GET, or ensure it's what we expect
    if not config.has_section('MAIN'):
        config.add_section('MAIN')
    config.set('MAIN', 'provider_model', ORIGINAL_PROVIDER_MODEL)
    # Ensure other necessary defaults if they were missing
    if not config.has_option('MAIN', 'provider_name'):
        config.set('MAIN', 'provider_name', 'ollama')
    if not config.has_option('MAIN', 'provider_server_address'):
        config.set('MAIN', 'provider_server_address', '127.0.0.1:11434') # Default for ollama
    if not config.has_option('MAIN', 'is_local'):
        config.set('MAIN', 'is_local', 'True')


    with open(CONFIG_FILE_PATH, 'w') as configfile:
        config.write(configfile)

    # Important: Re-initialize the actual_api.interaction.provider and config within api.py
    # This is tricky because the FastAPI app loads its config at import time.
    # For true isolation, the app should be created within the fixture or reconfigured.
    # For now, we'll rely on the fact that api.py re-reads config.ini for some parts,
    # and provider is re-initialized.
    # A more robust solution might involve patching config directly or a factory for the app.

    # Re-initialize parts of the application that depend on config.ini
    # This is a simplified approach. A real scenario might need to reload modules or use app factories.
    from api import initialize_system, config as api_config, interaction as api_interaction
    api_config.read(CONFIG_FILE_PATH) # Reload config in api.py's scope
    api_interaction_reloaded = initialize_system() # Re-initialize interaction system

    # Patch the global interaction object in the actual_api module
    # This is highly dependent on how 'api.py' is structured.
    # If 'interaction' is a global in 'api.py', this might work.
    import api as actual_api_module
    actual_api_module.interaction = api_interaction_reloaded
    actual_api_module.config = api_config


    client = TestClient(actual_api)
    return client

# Actual tests start here

def test_get_current_model(test_client):
    """
    Tests if the GET /model endpoint returns the model name
    currently set in config.ini (which is ORIGINAL_PROVIDER_MODEL by the fixture).
    """
    response = test_client.get("/model")
    assert response.status_code == 200
    data = response.json()
    assert "model_name" in data
    assert data["model_name"] == ORIGINAL_PROVIDER_MODEL


def test_set_model_successfully(test_client):
    """
    Tests if the POST /model endpoint successfully updates the model name
    in config.ini and reflects this change in a subsequent GET /model call.
    """
    new_model_name = "ollama/test-model:latest"
    response_post = test_client.post("/model", json={"model_name": new_model_name})
    assert response_post.status_code == 200
    assert response_post.json()["message"] == f"Model updated to {new_model_name}"

    # Verify config.ini was updated
    config = configparser.ConfigParser()
    config.read(CONFIG_FILE_PATH)
    assert config.get('MAIN', 'provider_model') == new_model_name

    # Verify GET /model returns the new model name
    # We need to re-initialize the client or the app's state for this to be accurate,
    # as the app's 'interaction.provider' object holds the model name loaded at its initialization.
    # The current 'test_client' fixture re-initializes 'interaction' for each test,
    # but not *during* a test after a POST call.
    # For this test, we are checking the config file directly and also what a *new* GET request
    # (to a potentially re-initialized app state if the global patching in fixture works across calls)
    # would return.

    # Re-fetch the client to simulate the app reloading the config for the provider
    # This part is tricky due to FastAPI's config loading.
    # A direct check of provider.get_model_name() within the same app instance might not reflect the change
    # immediately unless set_model also updates the in-memory provider instance that GET /model uses.
    # The current api.py implementation does update interaction.provider.set_model(), so it should be fine.

    response_get = test_client.get("/model")
    assert response_get.status_code == 200
    data_get = response_get.json()
    assert data_get["model_name"] == new_model_name

    # Also check the interaction object directly if possible and safe (beware of state across tests)
    # This depends on how `actual_api_module.interaction` is made available and patched.
    import api as actual_api_module
    assert actual_api_module.interaction.provider.get_model_name() == new_model_name


def test_set_model_empty_string(test_client):
    """
    Tests POST /model with an empty string.
    Pydantic's SetModelRequest should make model_name a required string.
    FastAPI will return a 422 if validation fails.
    """
    response_post = test_client.post("/model", json={"model_name": ""})
    # Expecting a 422 Unprocessable Entity due to Pydantic validation
    # if SetModelRequest defines model_name: str (non-optional, non-empty)
    # If model_name: str = "" is allowed by Pydantic, then the API might return 200 or 500
    # based on provider.set_model behavior.
    # Assuming `model_name: str` in SetModelRequest means it cannot be empty by default with Pydantic v2.
    # If using Pydantic v1 or specific validators, this might differ.
    # For now, let's assume it's caught by Pydantic.
    # If the `provider.set_model` has its own validation for empty string that results in an error,
    # and Pydantic allows empty string, then this test would need adjustment.
    # The current `provider.set_model` logs an error and returns if model_name is empty/whitespace.
    # This means the API would proceed and then `set_model` would do nothing, leading to a 200 OK
    # but the model wouldn't actually change. This might be undesirable.
    # Let's refine this: The API should ideally return an error if `provider.set_model` effectively rejects the change.
    # However, `provider.set_model` doesn't raise an exception, it just logs and returns.
    # So, api.py's `/model` POST endpoint would still return 200.

    # Current behavior:
    # 1. Pydantic allows model_name = ""
    # 2. provider.set_model("") logs an error and returns early (provider's internal model doesn't change from ORIGINAL_PROVIDER_MODEL).
    # 3. api.py's POST /model endpoint *does* write "" to config.ini's provider_model.
    # 4. api.py's POST /model returns 200.

    assert response_post.status_code == 200
    assert response_post.json()["message"] == "Model updated to " # Message reflects the empty string

    # Verify config.ini was updated with the empty string by api.py
    config = configparser.ConfigParser()
    config.read(CONFIG_FILE_PATH)
    assert config.get('MAIN', 'provider_model') == ""

    # Verify GET /model returns the empty string (because it reads from the updated config via initialize_system in fixture, then provider)
    # The test_client fixture re-initializes the system, so the provider will pick up the empty string from config.
    # However, the provider.set_model itself would have rejected it for internal use for llm_server.
    # This highlights an inconsistency. For this test, we check what GET /model returns.

    # Re-running initialize_system for the GET call is implicitly handled by how TestClient works
    # if the app state is truly reset or reloaded.
    # The test_client fixture aims to do this.
    # The interaction.provider.get_model_name() inside GET /model will reflect the re-initialized provider state.

    # After POST, the api.py's interaction.provider object was called with set_model("").
    # It logged an error and its self.model is still ORIGINAL_PROVIDER_MODEL.
    # However, config.ini was set to "" by api.py.
    # A subsequent GET /model, if it re-initializes from config.ini (as our test_client fixture tries to ensure),
    # will initialize the provider with "" from config.ini.

    # Let's check the provider's state within the API context *after* the POST call,
    # but *before* any potential re-initialization for a new GET request.
    import api as actual_api_module
    # Provider.set_model("") was called, it returned early. Provider's model should still be the original.
    assert actual_api_module.interaction.provider.get_model_name() == ORIGINAL_PROVIDER_MODEL

    # Now, what a *new* GET /model call returns. The test_client fixture re-runs initialize_system
    # which reads config.ini. Since config.ini now has "", the newly initialized provider for this GET
    # request context will have "" as its model.
    response_get = test_client.get("/model")
    assert response_get.status_code == 200
    assert response_get.json()["model_name"] == "" # Because config.ini was changed to "" and GET re-initializes from it.


# Remove placeholder test
# def test_placeholder():
#    assert True
