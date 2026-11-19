import React, { useState, useRef } from 'react';
import { Grid, Modal, Button } from '@strapi/design-system';
import {
  ReactAsyncSelect as AsyncSelect,
  ReactSelect as Select
} from './ui/ReactSelect';
import { GroupInput } from './ui/StyledWrappers';
import { Formik, Form, useFormikContext } from 'formik';
import { useFetchClient } from '@strapi/strapi/admin';
import { useGetOptions } from '../hooks/useGetOptions';
import { initialValuesCategorización as initialValues } from '../config/formik.initial';
import { validationSchemaCategorización as validationSchema } from '../config/formik.schema';

const ModalDemandado = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const mainForm = useFormikContext<FormValuesJuicio>()
  const [categories, setCategories] = useState<OptionType[]>([]);
  const [subcategories, setSubcategories] = useState<OptionType[]>([]);
  const [accCategories, setAccCategories] = useState<CategoriesGrouped[]>([]);
  const [lastSelectedCategories, setLastSelectedCategories] = useState<OptionType[]>([]);
  const { get } = useFetchClient();
  const { getOptions } = useGetOptions();
  const catRef = useRef<any>(null)
  const subcatRef = useRef<any>(null)

  const fetchCategories = async (entityId: string) => {
    try {
      const loadCategories = getOptions('categoria', entityId);
      const result = await loadCategories('');
      setCategories(result);
      setSubcategories([]);
      setAccCategories([]);
    } catch (error) {
      console.error('🚀 ~ ModalDemandado.tsx ~ error:', error);
    }
  };
  const fetchSubcategories = async (
    selectedOption: OptionsType,
    values: Categorization,
    setFieldValue: (field: string, value: any, shouldValidate?: boolean) => void
  ) => {
    if (!Array.isArray(selectedOption) || selectedOption.length === 0) {
      setAccCategories([]);
      setLastSelectedCategories([]);
      setSubcategories([]);
      //subcatRef.current?.clearValue()
      setFieldValue('categoria', initialValues.categoria);
      setFieldValue('subcategoria', initialValues.subcategoria);
      return;
    }

    // Verificar si se eliminaron categorías padre
    const removedCategories = lastSelectedCategories.filter(
      lastCat => !selectedOption.some(newCat => newCat.id === lastCat.id)
    );

    // Si se eliminaron categorías, actualizar subcategorías en Formik y accCategories
    if (removedCategories.length > 0) {
      const currentSubcategories = values.subcategoria || [];
      const updatedSubcategories = currentSubcategories.filter(subcat =>
        selectedOption.some(cat => cat.id === subcat.parentId)
      );
      setFieldValue('subcategoria', updatedSubcategories);

      // Actualizar accCategories para mantener solo las categorías seleccionadas
      setAccCategories(prev =>
        prev.filter(cat =>
          selectedOption.some(selected => selected.value === cat.categoria.value)
        )
      );

      // Limpiar subcategorías para forzar la actualización de la UI
      //setSubcategories([]);
    }

    // Actualizar el último estado de categorías seleccionadas
    setLastSelectedCategories(selectedOption);

    const query = selectedOption.map(item => `categorias[]=${item.value}`).join('&');
    const url = `/causas/subcategoria?${query}`;
    try {
      const { data } = await get(url);
      const buildCat = selectedOption.map((category, index) => {
        const emptySubCategory = {
          categoria: category,
          subcategoria: []
        };
        setAccCategories((prev) => {
          const exists = prev.some(p => p.categoria.value === category.value);
          if (!exists) {
            const newState = [...prev, emptySubCategory];
            return newState;
          }
          return prev;
        });
        return data[index]?.map((item: ResponseToOptions) => ({
          id: item.id,
          parentId: category.id,
          label: item.nombre,
          value: item.documentId
        })) || [];
      });

      const subcat = buildCat.flat();
      setSubcategories(subcat);
      setFieldValue('categoria', selectedOption);
    } catch (error) {
      console.error("🚀 ~ ModalDemandado.tsx ~ fetchSubcategories ~ error:", error)
    }
  };

  const handleCategoriesGrouped = (selectedOption: OptionsType) => {
    // Create a map to group subcategories by parent category
    const groupedSubcategories = selectedOption.reduce((acc, subcat) => {
      const parentCategory = categories.find(cat => cat.id === subcat.parentId);

      if (parentCategory) {
        if (!acc[parentCategory.value]) {
          acc[parentCategory.value] = {
            categoria: parentCategory,
            subcategoria: []
          };
        }
        acc[parentCategory.value].subcategoria.push(subcat);
      }
      return acc;
    }, {} as Record<string, CategoriesGrouped>);

    setAccCategories((prev) => {
      // Crear un nuevo array con las categorías actualizadas
      const updatedCategories = prev.map(category => {
        // Buscar si esta categoría tiene subcategorías en la nueva selección
        const newSubcategories = selectedOption.filter(subcat => {
          const parentCategory = categories.find(cat => cat.id === subcat.parentId);
          return parentCategory?.value === category.categoria.value;
        });

        // Si hay subcategorías seleccionadas para esta categoría, actualizar
        if (newSubcategories.length > 0) {
          return {
            categoria: category.categoria,
            subcategoria: newSubcategories
          };
        }

        // Si no hay subcategorías seleccionadas, mantener la categoría con array vacío
        return {
          categoria: category.categoria,
          subcategoria: []
        };
      });

      // Agregar nuevas categorías que no existían antes
      Object.values(groupedSubcategories).forEach(newGroup => {
        const exists = updatedCategories.some(
          cat => cat.categoria.value === newGroup.categoria.value
        );
        if (!exists) {
          updatedCategories.push(newGroup);
        }
      });

      return updatedCategories;
    });
  }

  const handleOnSubmit = (values: Categorization, actions: any) => {
    mainForm.setFieldValue('demandado', values.entidad);
    mainForm.setFieldValue('categoria', values.categoria);
    mainForm.setFieldValue('subcategoria', values.subcategoria);
    mainForm.setFieldValue('categorias_agrupadas', accCategories);
    //actions.resetForm();
    setOpen(false)
  }

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Formik initialValues={initialValues} validationSchema={validationSchema} onSubmit={handleOnSubmit}>
        {({ values, setFieldValue }) => {
          return (
            <Modal.Content onPointerDownOutside={() => false}>
              <Modal.Header>
                <Modal.Title>Entidad demandada y asignación de categorías</Modal.Title>
              </Modal.Header>
              <Form>
                <Modal.Body>
                  <Grid.Item xs={12} marginBottom={4}>
                    <GroupInput>
                      <AsyncSelect
                        label="Demandado (Administración Tributaria)"
                        name="entidad"
                        placeholder="Seleccionar una entidad"
                        loadOptions={getOptions('entidades')}
                        onSelectChange={(newValue: OptionType | null) => {
                          if (newValue) {
                            fetchCategories(newValue.value);
                            setTimeout(() => {
                              catRef.current?.clearValue();
                              subcatRef.current?.clearValue();
                              setFieldValue('categoria', []);
                              catRef.current?.focus();
                            }, 100);
                            setFieldValue('entidad', newValue);
                          } else {
                            setFieldValue('entidad', initialValues.entidad);
                            setFieldValue('categoria', initialValues.categoria);
                            setFieldValue('subcategoria', initialValues.subcategoria);
                          }
                        }}
                      />
                    </GroupInput>
                  </Grid.Item>
                  <Grid.Item xs={12} marginBottom={4}>
                    <GroupInput>
                      <Select
                        ref={catRef}
                        name="categoria"
                        label="Categorías"
                        placeholder="Seleccionar una o varias categorías"
                        options={categories}
                        isMulti={true}
                        onSelectChange={(selectedOption: OptionType[]) => {
                          fetchSubcategories(selectedOption, values, setFieldValue);
                        }}
                      />
                    </GroupInput>
                  </Grid.Item> <Grid.Item xs={12} marginBottom={4}>
                    <GroupInput>
                      <Select
                        ref={subcatRef}
                        name="subcategoria"
                        label="Subcategorías"
                        placeholder="Seleccionar una o varias categorías"
                        options={subcategories}
                        isMulti={true}
                        onSelectChange={(selectedOption: OptionType[]) => {
                          handleCategoriesGrouped(selectedOption);
                          setFieldValue('subcategoria', selectedOption);
                        }}
                      />
                    </GroupInput>
                  </Grid.Item>
                </Modal.Body>
                <Modal.Footer>
                  <Modal.Close>
                    <Button variant="tertiary" onClick={() => {
                      setOpen(false)
                    }}>Cancel</Button>
                  </Modal.Close>
                  <Button type="submit">Confirmar</Button>
                </Modal.Footer>
              </Form>
            </Modal.Content>
          )
        }}
      </Formik>
    </Modal.Root>
  );
};

export default ModalDemandado;
