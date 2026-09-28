package httpapi

import (
	"encoding"
	"encoding/json"
	"reflect"
)

// emptyLists returns v with every nil slice and nil map it reaches replaced
// by an empty one, so a response never carries `null` where the contract
// promises a list or an object. Go marshals a nil slice as `null`, and the
// SPA maps over lists without checking: one forgotten `make` in a service
// turned a whole page blank (#519). Fixing it here covers every endpoint.
//
// The value is copied only along the paths that change; v itself is never
// modified. Nil pointers and interfaces stay `null`, since the contract uses
// those for "absent". Types with their own JSON or text encoding (time.Time,
// json.RawMessage, ...) and byte slices are left alone.
func emptyLists(v any) any {
	if v == nil {
		return nil
	}
	out, changed := fillLists(reflect.ValueOf(v))
	if !changed {
		return v
	}
	return out.Interface()
}

var (
	jsonMarshaler = reflect.TypeFor[json.Marshaler]()
	textMarshaler = reflect.TypeFor[encoding.TextMarshaler]()
)

// encodesItself reports whether encoding/json hands t (or *t) to its own
// marshaller, whose output this walk must not second-guess.
func encodesItself(t reflect.Type) bool {
	pt := reflect.PointerTo(t)
	return t.Implements(jsonMarshaler) || t.Implements(textMarshaler) ||
		pt.Implements(jsonMarshaler) || pt.Implements(textMarshaler)
}

// fillLists returns the filled copy of v and whether anything changed.
// When nothing changed it returns v unchanged.
func fillLists(v reflect.Value) (reflect.Value, bool) {
	if v.Kind() != reflect.Pointer && v.Kind() != reflect.Interface && encodesItself(v.Type()) {
		return v, false
	}
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() || encodesItself(v.Type()) {
			return v, false
		}
		elem, changed := fillLists(v.Elem())
		if !changed {
			return v, false
		}
		p := reflect.New(v.Type().Elem())
		p.Elem().Set(elem)
		return p, true

	case reflect.Interface:
		if v.IsNil() {
			return v, false
		}
		elem, changed := fillLists(v.Elem())
		if !changed {
			return v, false
		}
		out := reflect.New(v.Type()).Elem()
		out.Set(elem)
		return out, true

	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return v, false // []byte encodes as a base64 string
		}
		if v.IsNil() {
			return reflect.MakeSlice(v.Type(), 0, 0), true
		}
		var out reflect.Value
		for i := range v.Len() {
			elem, changed := fillLists(v.Index(i))
			if !changed {
				continue
			}
			if !out.IsValid() {
				out = reflect.MakeSlice(v.Type(), v.Len(), v.Len())
				reflect.Copy(out, v)
			}
			out.Index(i).Set(elem)
		}
		if !out.IsValid() {
			return v, false
		}
		return out, true

	case reflect.Array:
		var out reflect.Value
		for i := range v.Len() {
			elem, changed := fillLists(v.Index(i))
			if !changed {
				continue
			}
			if !out.IsValid() {
				out = reflect.New(v.Type()).Elem()
				out.Set(v)
			}
			out.Index(i).Set(elem)
		}
		if !out.IsValid() {
			return v, false
		}
		return out, true

	case reflect.Map:
		if v.IsNil() {
			return reflect.MakeMap(v.Type()), true
		}
		var out reflect.Value
		iter := v.MapRange()
		for iter.Next() {
			elem, changed := fillLists(iter.Value())
			if !changed {
				continue
			}
			if !out.IsValid() {
				out = reflect.MakeMapWithSize(v.Type(), v.Len())
				for _, k := range v.MapKeys() {
					out.SetMapIndex(k, v.MapIndex(k))
				}
			}
			out.SetMapIndex(iter.Key(), elem)
		}
		if !out.IsValid() {
			return v, false
		}
		return out, true

	case reflect.Struct:
		var out reflect.Value
		t := v.Type()
		for i := range t.NumField() {
			f := t.Field(i)
			if !f.IsExported() || f.Tag.Get("json") == "-" {
				continue
			}
			elem, changed := fillLists(v.Field(i))
			if !changed {
				continue
			}
			if !out.IsValid() {
				out = reflect.New(t).Elem()
				out.Set(v)
			}
			out.Field(i).Set(elem)
		}
		if !out.IsValid() {
			return v, false
		}
		return out, true
	}
	return v, false
}
