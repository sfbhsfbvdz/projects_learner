CHROME_EXTENSION_DIR := chrome_extension
PYTHON_FILES := agents/layer1_map/agent.py agents/layer1_map/github_tools.py

.PHONY: check extension-typecheck extension-build python-check

check: extension-typecheck extension-build python-check

extension-typecheck:
	cd $(CHROME_EXTENSION_DIR) && npm run typecheck

extension-build:
	cd $(CHROME_EXTENSION_DIR) && npm run build

python-check:
	python3 -m py_compile $(PYTHON_FILES)
