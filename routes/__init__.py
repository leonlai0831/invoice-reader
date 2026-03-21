"""Flask blueprint registration."""

from routes.config_routes import config_bp
from routes.invoice_routes import invoice_bp
from routes.cc_routes import cc_bp
from routes.claim_routes import claim_bp


def register_blueprints(app):
    """Register all route blueprints on *app*."""
    app.register_blueprint(config_bp)
    app.register_blueprint(invoice_bp)
    app.register_blueprint(cc_bp)
    app.register_blueprint(claim_bp)
