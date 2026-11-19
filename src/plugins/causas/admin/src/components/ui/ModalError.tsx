import { Button, Dialog } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { useFormikContext } from 'formik';


export default function ModalError() {
    const { values, setFieldValue } = useFormikContext<FormValuesJuicio>();
    return (
        <Dialog.Root open={values.isOpen}>
            <Dialog.Content>
                <Dialog.Header>Mensaje de error</Dialog.Header>
                <Dialog.Body icon={<WarningCircle fill="danger600" />}>
                    {typeof values.error_message === 'string' ? values.error_message : 'Ha ocurrido un error'}
                </Dialog.Body>
                <Dialog.Footer>
                    <Dialog.Cancel>
                        <Button onClick={() => setFieldValue('isOpen', false)} fullWidth variant="tertiary" size="S">
                            Cerrar
                        </Button>
                    </Dialog.Cancel>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    )
}