"""Infosys careers endpoints."""

LABEL = "Infosys"
LOGIN_URL = "https://career.infosys.com/login"          # redirects to Keycloak (intapidm.infosysapps.com)
APPLICATIONS_URL = "https://career.infosys.com/jobs/myapplication"
# the authed REST call that returns candidateApplicationsList
APPLICATIONS_API_MARKER = "getCandidateApplications"
