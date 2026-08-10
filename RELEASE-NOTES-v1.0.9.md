# XPlane2FLT v1.0.9

- Keeps aircraft preview materials two-sided so cabin and cockpit faces remain visible.
- Recovers uniquely identifiable textures when third-party aircraft packages store them under a mismatched relative root.
- Corrects the vertical sampling orientation of DDS textures, including the inverted pilot texture seen in the MH-60R test aircraft.
- Refuses ambiguous basename fallbacks so liveries with duplicate texture names are not silently mixed.
