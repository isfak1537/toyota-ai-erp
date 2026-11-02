"""Errors a service raises for a request it cannot serve."""


class ServiceError(RuntimeError):
    """`status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status
