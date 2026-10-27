class ConversionError(Exception):
    """Ошибка конвератции с понятным пользовательским текстом."""


class UnsupportedConversion(ConversionError):
    """Такой пары форматов нет в реестре."""
